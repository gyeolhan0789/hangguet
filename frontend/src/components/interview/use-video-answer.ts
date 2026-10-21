"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createAnswerAudioUploadUrl, sendReaction } from "@/lib/interview/actions";
import {
  prepareAnswer,
  submitPreparedAnswer,
  type AnswerUpload,
  type PreparedAnswer,
  type SubmitOutcome,
} from "@/lib/interview/answer-submission";
import {
  initialAutoSubmitState,
  nextAutoSubmit,
  type AutoSubmitEvent,
} from "@/lib/interview/auto-submit";
import { createReactionSender, type ReactionSender } from "@/lib/interview/reaction-sender";
import type { SpeechActionFailure } from "@/lib/interview/speech-failure";
import { createAnswerCapture, type AnswerCapture } from "@/lib/stt/answer-capture";

import { useAnswerStt, type AnswerSttStatus } from "./use-answer-stt";
import type {
  AnswerStartFailure,
  VideoAnswer,
  VideoAnswerOptions,
  VideoAnswerPhase,
} from "./video-answer-contract";

// 기준: video-answer-contract.ts(화상 답변 훅 계약) · API 명세 5.6 · 5.7(화상 자동 제출 7초 · 60초, 빈 답변은 제출하지 않음,
// Idempotency-Key로 같은 본문 재전송, 화상 content 1~10,000자)
// · 기획 메모 S06(화상 = 입력 폼 없음, STT 자막, [답변 완료] 또는 일정 시간 침묵 시 다음 질문)
// 화상 답변 한 번(답변 시작 → 듣기 → 제출)을 관리한다. 화면(S06)은 이 훅의 phase · caption과 함수만 사용한다.
// 다음 질문(5.5) · 면접 종료(5.8)는 onSubmitted의 결과로 화면이 호출한다.

/** 7초 · 60초를 확인하는 간격(밀리초) */
const TICK_MS = 250;

/** 5.7 화상 content 최대 글자 수(mock AnswerRequest content @Size(max = 10_000)). 초과하면 400(API 명세 5.7) */
const MAX_VOICE_CONTENT_LENGTH = 10_000;

/** 최대 글자 수를 초과한 답변. 5.7을 전송하지 않고 서버가 반환할 400과 같은 실패로 표시한다 */
const CONTENT_TOO_LONG: SpeechActionFailure = { ok: false, code: "VALIDATION_FAILED", status: 400 };

export function useVideoAnswer({
  sessionId,
  questionId,
  questionText,
  onSubmitted,
  onReaction,
}: VideoAnswerOptions): VideoAnswer {
  const [phase, setPhase] = useState<VideoAnswerPhase>("idle");
  const [startFailure, setStartFailure] = useState<AnswerStartFailure | null>(null);
  const [submitFailure, setSubmitFailure] = useState<SpeechActionFailure | null>(null);
  const phaseRef = useRef<VideoAnswerPhase>("idle");
  /** 화면이 마운트돼 있는지. 대기(5.6 · 파일 녹음 stop · 5.7) 이후 확인해 이탈한 화면에서 업로드 · 제출하지 않는다 */
  const alive = useRef(true);
  const capture = useRef<AnswerCapture | null>(null);
  const fileStartedAt = useRef(0);
  const upload = useRef<AnswerUpload | null>(null);
  const prepared = useRef<PreparedAnswer | null>(null);
  const auto = useRef(initialAutoSubmitState);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const reactions = useRef<ReactionSender | null>(null);
  const latest = useRef({ sessionId, questionId, questionText, onSubmitted, onReaction });

  useEffect(() => {
    latest.current = { sessionId, questionId, questionText, onSubmitted, onReaction };
  });

  const moveTo = useCallback((next: VideoAnswerPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const stt = useAnswerStt({
    sessionId,
    onSpeech: (at) => feed({ type: "speech", at }),
    onSentence: (sentence) => reactions.current?.send(sentence),
  });
  const sttRef = useRef(stt);
  useEffect(() => {
    sttRef.current = stt;
  });

  const stopTicker = useCallback(() => {
    if (ticker.current !== null) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  /** 면접관 리액션 요청을 중지하고, 이미 요청한 응답도 폐기한다(답변 제출 뒤 도착한 응답은 사용하지 않는다) */
  const stopReactions = useCallback(() => {
    reactions.current?.stop();
    reactions.current = null;
  }, []);

  const release = useCallback(() => {
    stopTicker();
    stopReactions();
    capture.current?.dispose();
    capture.current = null;
  }, [stopReactions, stopTicker]);

  const deliver = useCallback(
    (outcome: SubmitOutcome) => {
      if (outcome.kind === "failed") {
        // 다시 전송할 음성은 제출 데이터에 있으므로 마이크는 더 사용하지 않는다. 실패 동안 마이크를 유지하지 않는다.
        capture.current?.dispose();
        capture.current = null;
        prepared.current = outcome.next;
        setSubmitFailure(outcome.failure);
        moveTo("submitFailed");
        return;
      }
      prepared.current = null;
      release();
      moveTo("submitted");
      latest.current.onSubmitted(outcome);
    },
    [moveTo, release],
  );

  const submit = useCallback(async () => {
    if (phaseRef.current !== "listening" || !capture.current) return;
    feed({ type: "submitStarted" });
    moveTo("submitting");
    stopTicker();
    stopReactions();
    const stt = sttRef.current;
    await stt.stop();
    const { content, tokens } = stt.getAnswer();
    const current = capture.current;
    if (!current) return;
    if (content === "") {
      // 빈 답변은 제출하지 않고 다시 듣는다(파일 녹음은 계속한다).
      startListening(current, { type: "relisten", at: performance.now() });
      return;
    }
    if (content.length > MAX_VOICE_CONTENT_LENGTH) {
      // 다시 전송해도 같은 400이 반환되므로 답변 전으로 되돌리고, 화면이 답변이 너무 길다고 안내하도록 실패를 전달한다.
      release();
      setSubmitFailure(CONTENT_TOO_LONG);
      moveTo("idle");
      return;
    }
    const audio = await current.stopFile();
    if (!alive.current) return;
    const target = upload.current;
    if (!audio || !target) {
      // 파일 녹음기가 중지된 상태였다(마이크 연결 끊김). 제출할 음성이 없으므로 답변 전으로 되돌린다.
      release();
      setStartFailure({ kind: "device", reason: "ended" });
      moveTo("idle");
      return;
    }
    const { sessionId: session, questionId: question } = latest.current;
    prepared.current = prepareAnswer({
      sessionId: session,
      questionId: question,
      content,
      tokens,
      audio,
      upload: target,
    });
    const outcome = await submitPreparedAnswer(prepared.current);
    if (!alive.current) return;
    deliver(outcome);
    // feed · startListening은 아래에서 정의하는 함수 선언이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliver, moveTo, release, stopReactions, stopTicker]);

  /** 자동 제출 판단에 이벤트를 전달하고, 7초 · 60초 결정을 실행한다 */
  function feed(event: AutoSubmitEvent) {
    const step = nextAutoSubmit(auto.current, event);
    auto.current = step.state;
    if (step.decision === "submit") void submit();
    if (step.decision === "timeout") timeOut();
  }

  /** 60초 동안 말을 시작하지 않았다. 음성 인식과 파일까지 폐기한다(과금 방지) */
  function timeOut() {
    sttRef.current.cancel();
    release();
    moveTo("timedOut");
  }

  function startListening(current: AnswerCapture, event: AutoSubmitEvent) {
    const { sessionId: session, questionId: question } = latest.current;
    reactions.current = createReactionSender({
      request: (seq, sentence) =>
        sendReaction(session, question, { seq, text: sentence.text, pauseMs: sentence.pauseMs }),
      onReaction: (response) => latest.current.onReaction?.(response),
    });
    sttRef.current.start({
      capture: current,
      fileStartedAt: fileStartedAt.current,
      questionText: latest.current.questionText,
    });
    feed(event);
    moveTo("listening");
    stopTicker();
    ticker.current = setInterval(() => feed({ type: "tick", now: performance.now() }), TICK_MS);
  }

  const start = useCallback(
    async (stream?: MediaStream) => {
      if (phaseRef.current !== "idle" && phaseRef.current !== "timedOut") return;
      moveTo("starting");
      setStartFailure(null);
      setSubmitFailure(null);
      const next = createAnswerCapture();
      capture.current = next;
      const begun = await next.start(stream);
      if (capture.current !== next) return;
      if (!begun.ok) {
        release();
        setStartFailure({ kind: "device", reason: begun.reason });
        moveTo("idle");
        return;
      }
      const { sessionId: session, questionId: question } = latest.current;
      const url = await createAnswerAudioUploadUrl(session, question, begun.contentType);
      if (capture.current !== next) return;
      if (!url.ok) {
        release();
        setStartFailure({ kind: "uploadUrl", failure: url });
        moveTo("idle");
        return;
      }
      fileStartedAt.current = begun.fileStartedAt;
      upload.current = {
        uploadUrl: url.uploadUrl,
        objectKey: url.objectKey,
        expiresAt: url.expiresAt,
        contentType: begun.contentType,
      };
      startListening(next, { type: "answerStarted", at: performance.now() });
    },
    // startListening은 렌더마다 새로 생성되지만 ref만 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moveTo, release],
  );

  const retry = useCallback(async () => {
    const current = prepared.current;
    if (phaseRef.current !== "submitFailed" || !current) return;
    moveTo("submitting");
    const outcome = await submitPreparedAnswer(current);
    if (!alive.current) return;
    deliver(outcome);
  }, [deliver, moveTo]);

  const reconnect = useCallback(() => {
    if (phaseRef.current !== "listening") return;
    // 이미 인식된 글이 있으면 7초 자동 제출로 전달한다(60초 종료로 글과 파일을 폐기하지 않는다).
    const hasAnswer = sttRef.current.getAnswer().content !== "";
    sttRef.current.reconnect();
    feed({ type: "manualReconnect", at: performance.now(), hasAnswer });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 음성 인식 연결 상태를 자동 제출 판단에 전달한다(SDK 자동 재연결 동안 7초를 중지한다).
  const previousStatus = useRef<AnswerSttStatus>("idle");
  useEffect(() => {
    const before = previousStatus.current;
    previousStatus.current = stt.status;
    if (phaseRef.current !== "listening") return;
    if (stt.status === "reconnecting") feed({ type: "reconnecting" });
    else if (stt.status === "listening" && before === "reconnecting") {
      feed({ type: "reconnected", at: performance.now() });
    } else if (stt.status === "error") feed({ type: "sttError" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.status]);

  // 질문이 변경되면 앞 질문의 답변을 폐기하고 답변 전으로 돌아간다. 같은 훅으로 다음 질문을 수신해도 [답변 시작]이 활성화된다.
  const shownQuestion = useRef(questionId);
  useEffect(() => {
    if (shownQuestion.current === questionId) return;
    shownQuestion.current = questionId;
    sttRef.current.cancel();
    release();
    prepared.current = null;
    upload.current = null;
    auto.current = initialAutoSubmitState;
    setStartFailure(null);
    setSubmitFailure(null);
    moveTo("idle");
  }, [questionId, moveTo, release]);

  // 화면을 떠나면 타이머를 해제하고 마이크를 해제한다(음성 인식은 훅이 스스로 종료한다).
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      release();
    };
  }, [release]);

  return {
    phase,
    caption: stt.caption,
    sttStatus: stt.status,
    startFailure,
    submitFailure,
    start,
    submit,
    retry,
    reconnect,
  };
}
