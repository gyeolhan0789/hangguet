"use client";

import {
  AuthError,
  SonioxClient,
  type ContextGeneralEntry,
  type Recording,
  type RecordingState,
  type StateChangeReason,
  type TranscriptionContext,
} from "@soniox/client";
import { useCallback, useEffect, useRef, useState } from "react";

import { issueSttToken } from "@/lib/interview/actions";
import type { AnswerCapture } from "@/lib/stt/answer-capture";
import {
  applyResult,
  beginConnection,
  createTranscript,
  getCaption,
  getContent,
  toAnswerTokens,
  type Transcript,
} from "@/lib/stt/transcript";
import type { TranscriptToken } from "@/types/api";

// 기준: Swagger 5.10 실시간 음성 인식 토큰(연결할 때마다 새 키) · API 명세 5.7(화상 답변 content · tokens, 7초는 마지막 말소리가
// 인식된 때부터) · @soniox/client 2.4.0 Recording(record · stop · cancel · auto_reconnect · signal)
// 화상 답변을 Soniox로 인식한다. 브라우저 WebSocket은 헤더를 지정할 수 없으므로 SDK가 키를 WebSocket 서브프로토콜로 전송한다
// (SDK auth_transport "protocol-list").

/** 음성 인식 모델(API 명세 5.10) */
const STT_MODEL = "stt-rt-v5";

/** 한국어 답변에 영어 개발 용어가 포함된다 */
const LANGUAGE_HINTS = ["ko", "en"];

/** 음성 인식 맥락의 분야 설명. 언어 지시는 포함하지 않는다 */
const CONTEXT_GENERAL: ContextGeneralEntry[] = [
  { key: "domain", value: "소프트웨어 개발" },
  { key: "topic", value: "기술 면접 답변" },
];

/** 음성 인식 맥락의 개발 용어. 언어 지식 기반 초안이며 로컬 실측(인식률)으로 보정한다 */
const CONTEXT_TERMS = [
  "API",
  "REST",
  "HTTP",
  "JavaScript",
  "TypeScript",
  "React",
  "Next.js",
  "Java",
  "Spring Boot",
  "JPA",
  "MySQL",
  "Redis",
  "Docker",
  "AWS",
  "Git",
  "CI/CD",
];

/**
 * 훅 상태. SDK 녹음 상태 10개를 아래와 같이 대응시킨다.
 * - idle · starting · connecting → connecting. 단 자동 재연결 안의 connecting(reason "reconnecting")은 reconnecting
 * - recording · paused → listening
 * - reconnecting → reconnecting
 * - stopping · stopped · canceled → idle(듣지 않음)
 * - error → error
 */
export type AnswerSttStatus = "idle" | "connecting" | "listening" | "reconnecting" | "error";

export interface AnswerSttStart {
  /** 파일 녹음을 시작한 답변 녹음. 음성 인식은 같은 스트림을 사용한다 */
  capture: AnswerCapture;
  /** capture.start()가 반환한 파일 녹음기 시작 시각. tokens 시각의 기준 */
  fileStartedAt: number;
  /** 현재 질문 글. 음성 인식 맥락에 포함한다 */
  questionText: string;
}

export interface AnswerSttAnswer {
  /** 5.7 content: 확정 글 */
  content: string;
  /** 5.7 tokens. 400 조건에 해당하면 null(전송하지 않는다) */
  tokens: TranscriptToken[] | null;
}

export interface AnswerStt {
  status: AnswerSttStatus;
  /** 자막: 확정 글 + 미확정 글 */
  caption: string;
  /** 새 답변의 음성 인식을 시작한다. 인식된 글은 초기화한다 */
  start: (answer: AnswerSttStart) => void;
  /** 같은 답변에 음성 인식을 다시 연결한다([다시 연결]). 인식된 글은 유지하고 새 키 · 새 offset으로 연결한다 */
  reconnect: () => void;
  /**
   * 남은 음성을 전송하고 최종 결과를 기다린 뒤 종료한다. 재연결 중이거나 오류 상태면 최종 결과 없이 종료되고,
   * 재연결 중에 누적된 음성은 폐기한다. 어느 경우든 reject하지 않는다.
   */
  stop: () => Promise<void>;
  /** 최종 결과 없이 바로 종료한다(60초 종료 · 화면 이탈) */
  cancel: () => void;
  /** 지금까지 확정된 답변. 제출할 때 읽는다 */
  getAnswer: () => AnswerSttAnswer;
}

export interface AnswerSttOptions {
  sessionId: number;
  /** 말소리 신호: 한 연결 안에서 비공백 토큰 end_ms 최댓값이 늘어난 result를 수신한 시각(performance.now) */
  onSpeech?: (at: number) => void;
}

interface ActiveRecording {
  recording: Recording;
  controller: AbortController;
}

function toStatus(state: RecordingState, reason?: StateChangeReason): AnswerSttStatus {
  switch (state) {
    case "idle":
    case "starting":
      return "connecting";
    case "connecting":
      return reason === "reconnecting" ? "reconnecting" : "connecting";
    case "recording":
    case "paused":
      return "listening";
    case "reconnecting":
      return "reconnecting";
    case "stopping":
    case "stopped":
    case "canceled":
      return "idle";
    case "error":
      return "error";
  }
}

function buildContext(questionText: string): TranscriptionContext {
  return { general: CONTEXT_GENERAL, terms: CONTEXT_TERMS, text: questionText };
}

export function useAnswerStt({ sessionId, onSpeech }: AnswerSttOptions): AnswerStt {
  const [status, setStatus] = useState<AnswerSttStatus>("idle");
  const [caption, setCaption] = useState("");
  const active = useRef<ActiveRecording | null>(null);
  const answer = useRef<AnswerSttStart | null>(null);
  const transcript = useRef<Transcript>(createTranscript());
  /** AuthError(401)로 record()를 다시 호출한 적이 있는지. start · reconnect마다 한 번만 다시 호출한다 */
  const authRetried = useRef(false);
  const latest = useRef({ sessionId, onSpeech });

  useEffect(() => {
    latest.current = { sessionId, onSpeech };
  });

  /** 현재 녹음을 폐기한다. 이후 그 녹음에서 발생하는 이벤트는 모두 무시한다 */
  const abandon = useCallback(() => {
    const current = active.current;
    active.current = null;
    if (!current) return;
    // abort를 먼저 호출한다. record() 직후 같은 틱이면 SDK가 시작하지 않고 종료되며(cancel만 하면 run()이 starting으로 덮어써
    // 5.10을 호출한다), 연결 중인 WebSocket도 바로 닫힌다. abort로 발생하는 error는 아래 처리기가 무시한다.
    current.controller.abort();
    current.recording.cancel();
  }, []);

  const open = useCallback(() => {
    // AuthError 때 자기 자신을 다시 호출해야 해서 내부 함수로 정의한다.
    function connect() {
      const target = answer.current;
      if (!target) return;
      abandon();

      const controller = new AbortController();
      const { signal } = controller;
      // config는 녹음 시작과 자동 재연결마다 다시 호출된다. 그래서 연결할 때마다 5.10으로 새 키를 발급받는다.
      // 5.10이 실패하면 SDK는 다시 시도하지 않고 error로 종료한다.
      const client = new SonioxClient({
        config: async () => {
          const result = await issueSttToken(latest.current.sessionId);
          if (!result.ok) throw new Error("음성 인식 토큰(5.10) 발급 실패", { cause: result });
          return { api_key: result.token };
        },
      });
      const recording = client.realtime.record({
        model: STT_MODEL,
        language_hints: LANGUAGE_HINTS,
        enable_endpoint_detection: true,
        context: buildContext(target.questionText),
        source: target.capture.createSttSource(),
        // ConnectionError · NetworkError만 남은 횟수(기본 3회) 안에서 다시 연결한다. 재연결 대기 · config 중 오류는 바로 error다.
        auto_reconnect: true,
        signal,
      });

      /** 연결마다 offset(음성 인식 녹음기 시작 − 파일 시작, 음수 가능)을 새로 계산한다 */
      const begin = () => {
        const sttStartedAt = target.capture.getSttStartedAt();
        const offsetMs = sttStartedAt === null ? null : sttStartedAt - target.fileStartedAt;
        transcript.current = beginConnection(transcript.current, offsetMs);
        setCaption(getCaption(transcript.current));
      };

      let connected = false;
      recording.on("state_change", ({ new_state, reason }) => {
        if (signal.aborted) return;
        setStatus(toStatus(new_state, reason));
      });
      // 첫 연결은 connected로, 자동 재연결은 session_restart로 새 연결을 시작한다(SDK는 재연결 뒤에도 connected를 전송한다).
      recording.on("connected", () => {
        if (signal.aborted || connected) return;
        connected = true;
        begin();
      });
      recording.on("session_restart", () => {
        if (signal.aborted) return;
        begin();
      });
      recording.on("result", (result) => {
        if (signal.aborted) return;
        const before = transcript.current.speechEndMs;
        transcript.current = applyResult(transcript.current, result.tokens);
        setCaption(getCaption(transcript.current));
        const after = transcript.current.speechEndMs;
        if (after !== null && (before === null || after > before)) {
          latest.current.onSpeech?.(performance.now());
        }
      });
      recording.on("error", (error) => {
        // 정리(abort)로 발생하는 오류는 실패가 아니다.
        if (signal.aborted) return;
        // 401: 키가 거절됐다. 한 번만 record()를 새로 호출해 새 키 · 새 음성 인식 녹음기 · 새 offset으로 연결한다.
        if (error instanceof AuthError && !authRetried.current) {
          authRetried.current = true;
          connect();
          return;
        }
        // 402 · 429(QuotaError), 403, 413과 재연결이 끝난 오류는 [다시 연결]을 기다린다.
        setStatus("error");
      });

      active.current = { recording, controller };
      setStatus("connecting");
    }
    connect();
  }, [abandon]);

  const start = useCallback(
    (next: AnswerSttStart) => {
      answer.current = next;
      transcript.current = createTranscript();
      setCaption("");
      authRetried.current = false;
      open();
    },
    [open],
  );

  const reconnect = useCallback(() => {
    authRetried.current = false;
    open();
  }, [open]);

  const stop = useCallback(async () => {
    const current = active.current;
    if (!current) return;
    // 5.10 키를 발급받는 중(starting)에 SDK stop()을 호출하면 SDK가 stopping을 connecting으로 덮어써 Promise가 resolve되지 않는다
    // (@soniox/client 2.4.0 run()). 아직 전송한 음성이 없으므로 폐기하고 종료한다. connecting부터는 stop()이 남은 음성을 전송하고 종료된다.
    if (current.recording.state === "idle" || current.recording.state === "starting") {
      setStatus("idle");
      abandon();
      return;
    }
    try {
      // finished 이벤트를 별도로 기다리지 않는다. 재연결 중 · 오류 상태면 finished 없이 종료된다.
      await current.recording.stop();
    } catch {
      // 오류로 종료되어도 그때까지 확정된 토큰으로 진행한다.
    }
    if (active.current !== current) return;
    active.current = null;
    current.controller.abort();
    setStatus("idle");
  }, [abandon]);

  const cancel = useCallback(() => {
    setStatus("idle");
    abandon();
  }, [abandon]);

  const getAnswer = useCallback(
    (): AnswerSttAnswer => ({
      content: getContent(transcript.current),
      tokens: toAnswerTokens(transcript.current),
    }),
    [],
  );

  // 화면을 떠나면 최종 결과 없이 종료한다.
  useEffect(() => abandon, [abandon]);

  return { status, caption, start, reconnect, stop, cancel, getAnswer };
}
