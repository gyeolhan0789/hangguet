"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SpeechActionFailure } from "@/lib/interview/speech-failure";
import type { ReactionResponse } from "@/types/api";

import type { AnswerSttStatus } from "./use-answer-stt";
import type {
  AnswerStartFailure,
  VideoAnswer,
  VideoAnswerOptions,
  VideoAnswerPhase,
} from "./video-answer-contract";

// 기준: video-answer-contract.ts(화상 답변 훅 계약) · Swagger 5.11 면접관 리액션 200 예시(리액션 있음)
// 화면(S06) 개발용 목 훅이다. 실제 구현과 달리 서버 API · 마이크 · Soniox를 호출하지 않고, 시나리오에 따라 미리 정한 상태와 자막을 순서대로 반환한다.
// 실제 구현(useVideoAnswer)이 병합되면 화면은 import만 변경한다.

/**
 * normal: 자막 → 문장마다 리액션 → 자동 제출 → 접수 · sttError: 첫 문장 뒤 음성 인식 오류([다시 연결]로 이어서 진행)
 * · submitFailed: 첫 제출 실패([다시 시도]로 접수) · timedOut: 말 없이 종료([다시 시작]) · startFailed: 마이크 권한 거부
 */
export type MockVideoAnswerScenario =
  "normal" | "sttError" | "submitFailed" | "timedOut" | "startFailed";

export interface MockVideoAnswerOptions extends VideoAnswerOptions {
  /** 기본 normal */
  scenario?: MockVideoAnswerScenario;
  /** onSubmitted에 전달할 isLastQuestion. 기본 false */
  isLastQuestion?: boolean;
}

/** 자막으로 한 단어씩 보여 줄 답변. 문장 끝마다 onReaction을 호출한다 */
const SCRIPT = ["캐시 무효화 시점을 직접 설계했습니다.", "그래서 조회 응답 시간을 40% 줄였습니다."];

const WORDS = SCRIPT.flatMap((sentence, index) =>
  sentence.split(" ").map((text, position, all) => ({
    text,
    seq: index + 1,
    sentenceEnd: position === all.length - 1,
  })),
);

/** 시작 · 단어 인식 · 제출 응답을 재현하는 대기 시간. 실제 구현에는 없는 목 전용 값이다 */
export const MOCK_START_DELAY_MS = 300;
export const MOCK_WORD_INTERVAL_MS = 300;
export const MOCK_SUBMIT_DELAY_MS = 500;

/**
 * 마지막 말소리 뒤 자동 제출까지(API 명세 5.7, 임시 값). 실제 구현의 auto-submit.ts와 같은 값이며,
 * auto-submit.ts가 병합되면 그 상수를 가져오도록 변경한다.
 */
export const AUTO_SUBMIT_SILENCE_MS = 7_000;
/** 말을 시작하지 않은 채 음성 인식을 종료하기까지(API 명세 5.7, 임시 값). 위와 같이 auto-submit.ts 병합 후 변경한다 */
export const NO_SPEECH_TIMEOUT_MS = 60_000;

const SUBMIT_FAILURE: SpeechActionFailure = { ok: false, code: "INTERNAL_ERROR", status: 500 };

/** Swagger 5.11 200 예시(리액션 있음). seq만 문장 순서로 변경한다 */
function exampleReaction(seq: number): ReactionResponse {
  return {
    seq,
    reaction: {
      type: "gesture",
      state: null,
      expression: null,
      gesture: "nod",
      intensity: 0.6,
      durationMs: 1200,
      ttlMs: 1500,
      source: "server",
    },
    attitude: { interest: 0.7, trust: 0.6, tension: 0.2 },
    interrupt: null,
  };
}

export function useMockVideoAnswer({
  questionId,
  onSubmitted,
  onReaction,
  scenario = "normal",
  isLastQuestion = false,
}: MockVideoAnswerOptions): VideoAnswer {
  const [phase, setPhase] = useState<VideoAnswerPhase>("idle");
  const [caption, setCaption] = useState("");
  const [sttStatus, setSttStatus] = useState<AnswerSttStatus>("idle");
  const [startFailure, setStartFailure] = useState<AnswerStartFailure | null>(null);
  const [submitFailure, setSubmitFailure] = useState<SpeechActionFailure | null>(null);
  const phaseRef = useRef<VideoAnswerPhase>("idle");
  const sttRef = useRef<AnswerSttStatus>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** 다음에 보여 줄 단어 위치 */
  const nextWord = useRef(0);
  const sttErrored = useRef(false);
  const submitFailed = useRef(false);
  const latest = useRef({ onSubmitted, onReaction, scenario, isLastQuestion });

  useEffect(() => {
    latest.current = { onSubmitted, onReaction, scenario, isLastQuestion };
  });

  const moveTo = useCallback((next: VideoAnswerPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const setStt = useCallback((next: AnswerSttStatus) => {
    sttRef.current = next;
    setSttStatus(next);
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const later = useCallback((ms: number, run: () => void) => {
    timers.current.push(setTimeout(run, ms));
  }, []);

  const finishSubmit = useCallback(() => {
    if (latest.current.scenario === "submitFailed" && !submitFailed.current) {
      submitFailed.current = true;
      setSubmitFailure(SUBMIT_FAILURE);
      moveTo("submitFailed");
      return;
    }
    setSubmitFailure(null);
    moveTo("submitted");
    latest.current.onSubmitted({ kind: "accepted", isLastQuestion: latest.current.isLastQuestion });
  }, [moveTo]);

  const submit = useCallback(async () => {
    if (phaseRef.current !== "listening") return;
    clearTimers();
    setStt("idle");
    moveTo("submitting");
    later(MOCK_SUBMIT_DELAY_MS, finishSubmit);
  }, [clearTimers, finishSubmit, later, moveTo, setStt]);

  /** 남은 단어를 간격마다 자막에 추가하도록 예약하고, 마지막 단어 뒤에 자동 제출을 예약한다 */
  const speakRest = useCallback(() => {
    const from = nextWord.current;
    WORDS.slice(from).forEach((word, offset) => {
      const index = from + offset;
      later(MOCK_WORD_INTERVAL_MS * (offset + 1), () => {
        nextWord.current = index + 1;
        setCaption(
          WORDS.slice(0, index + 1)
            .map(({ text }) => text)
            .join(" "),
        );
        if (word.sentenceEnd) latest.current.onReaction?.(exampleReaction(word.seq));
        if (latest.current.scenario === "sttError" && word.sentenceEnd && !sttErrored.current) {
          // 남은 단어와 자동 제출 예약을 해제하고 [다시 연결]을 기다린다.
          sttErrored.current = true;
          clearTimers();
          setStt("error");
        }
      });
    });
    // 실제 구현의 7초 자동 제출과 같이 [답변 완료]와 같은 함수를 호출한다.
    later(
      MOCK_WORD_INTERVAL_MS * (WORDS.length - from) + AUTO_SUBMIT_SILENCE_MS,
      () => void submit(),
    );
  }, [clearTimers, later, setStt, submit]);

  const start = useCallback(
    (): Promise<void> =>
      new Promise((resolve) => {
        if (phaseRef.current !== "idle" && phaseRef.current !== "timedOut") {
          resolve();
          return;
        }
        clearTimers();
        nextWord.current = 0;
        sttErrored.current = false;
        submitFailed.current = false;
        setCaption("");
        setStartFailure(null);
        setSubmitFailure(null);
        moveTo("starting");
        setStt("connecting");
        later(MOCK_START_DELAY_MS, () => {
          if (latest.current.scenario === "startFailed") {
            setStartFailure({ kind: "device", reason: "denied" });
            setStt("idle");
            moveTo("idle");
          } else {
            setStt("listening");
            moveTo("listening");
            if (latest.current.scenario === "timedOut") {
              later(NO_SPEECH_TIMEOUT_MS, () => {
                setStt("idle");
                moveTo("timedOut");
              });
            } else {
              speakRest();
            }
          }
          resolve();
        });
      }),
    [clearTimers, later, moveTo, setStt, speakRest],
  );

  const retry = useCallback(async () => {
    if (phaseRef.current !== "submitFailed") return;
    moveTo("submitting");
    later(MOCK_SUBMIT_DELAY_MS, finishSubmit);
  }, [finishSubmit, later, moveTo]);

  const reconnect = useCallback(() => {
    if (phaseRef.current !== "listening" || sttRef.current !== "error") return;
    // 실제 구현과 같이 연결 중(connecting)을 거쳐 듣는 중이 된다.
    setStt("connecting");
    later(MOCK_START_DELAY_MS, () => {
      setStt("listening");
      speakRest();
    });
  }, [later, setStt, speakRest]);

  // 질문이 변경되면 실제 구현과 같이 답변 전으로 돌아간다.
  const shownQuestion = useRef(questionId);
  useEffect(() => {
    if (shownQuestion.current === questionId) return;
    shownQuestion.current = questionId;
    clearTimers();
    setCaption("");
    setStartFailure(null);
    setSubmitFailure(null);
    setStt("idle");
    moveTo("idle");
  }, [questionId, clearTimers, moveTo, setStt]);

  // 화면을 떠나면 타이머를 해제한다.
  useEffect(() => clearTimers, [clearTimers]);

  return {
    phase,
    caption,
    sttStatus,
    startFailure,
    submitFailure,
    start,
    submit,
    retry,
    reconnect,
  };
}
