"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { InterviewerStage } from "@/components/interview/interviewer-stage";
import { useInterviewRoom } from "@/components/interview/use-interview-room";
import { useOnline } from "@/components/use-online";
import { MaskIcon } from "@/components/mask-icon";
import { endSession, retryPlan, startSession } from "@/lib/interview/actions";
import { PERSONAS } from "@/lib/interview/personas";
import { TOTAL_QUESTIONS } from "@/lib/interview/questions";
import type { AnswerStateMessage } from "@/lib/interview/room-messages";
import { interviewerBackdrop } from "@/lib/interviewer/models";
import { useInterviewStore } from "@/stores/interview-store";
import type { CurrentQuestion, SessionResponse } from "@/types/api";

import { AnalyzingView } from "./analyzing-view";
import { AnswerCaption } from "./answer-caption";
import { ChatPanel } from "./chat-panel";
import { EndModal } from "./end-modal";
import { QuestionBubble } from "./question-bubble";
import { TopBar } from "./top-bar";
import { useInterviewMedia } from "./use-interview-media";
import { MicToast, SelfCamera, VideoControls } from "./video-panel";

// 기준: Figma S06 화상(18:2497) · S06-B 채팅(18:2574): 면접관 장면 위에 Fade Top(위 200 · rgba(11,13,20,.8)→0)
// · Fade Bottom(아래 480 · 0→rgba(11,13,20,.95)) · Lightning Flash(72% · 12% 지점 rgba(185,212,255,.18) 원형 빛)
// · Dialog(가운데 820 · 간격 12, 화상은 아래 68 · 채팅은 아래 5) · S06-1(18:4437: 장면 opacity .28)
// · 기획 메모 S06(18:757: 배경 씬은 페르소나별(악마 = 번개 폭풍)) · 기획 메모 S06-B(18:1050: S06과 레이아웃 동일, 하단만 입력 폼)
// · 모션 메모 S06(18:2569: 번개 플래시는 질문이 바뀔 때만) · 모션 메모 S06-1(18:4469: 면접 화면에서 그대로 이어짐 — 배경 면접관이
// 흐려지며(opacity 1→.28, blur 0→8px))
// · 웹 Swagger 5.2(status · planStatus · mode, planStatus FAILED는 5.3으로 재시도) · 5.5 지금 질문 · 5.4 면접 시작
// (채팅: 질문 준비가 끝나면 화면이 자동으로 부른다. 채팅도 면접방에 들어간다(송출 없이 수신·메시지만)) · 5.3 면접 플랜 재생성
// · 사용자 결정(2026-10-22: 준비 실패 문구는 '면접 준비에 실패했어요' + [다시 시도], S05와 같음)
// · 웹 Swagger 5.2 · 5.5(서버 작업이 끝났는지는 2초마다(임시 값) 다시 불러 확인 — 다음 질문은 5.5, 질문 준비 · 결과 분석은 5.2)

/** 다음 질문 · 결과 분석을 다시 조회하는 간격(웹 Swagger 5.2 · 5.5 "2초마다(임시 값)") */
export const SESSION_POLL_MS = 2000;
/** 채팅 면접방에 다시 들어가기 전 기다리는 시간과 연달아 다시 들어가는 횟수(사용자 결정 2026-10-26) */
export const CHAT_ROOM_RETRY_MS = 2000;
export const CHAT_ROOM_RETRIES = 3;

/** 면접 화면. 상태가 결과 분석 중(ANALYZING · COMPLETED)이면 S06-1, 아니면 방식에 따라 S06(화상) · S06-B(채팅)를 그린다. */
export function InterviewRoom({
  session,
  currentQuestion,
}: {
  session: SessionResponse;
  /** 5.5 지금 질문. 다음 질문을 만드는 중이거나 면접 중이 아니면 null */
  currentQuestion: CurrentQuestion | null;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const reset = useInterviewStore((state) => state.reset);
  const answeredQuestionId = useInterviewStore((state) => state.answeredQuestionId);
  const [refreshing, startRefresh] = useTransition();
  const online = useOnline();
  const interviewer = PERSONAS.find((info) => info.persona === session.persona)?.name ?? "";

  const analyzing = session.status === "ANALYZING" || session.status === "COMPLETED";
  // 방금 답한 질문이 그대로 오거나 질문이 없으면 다음 질문을 기다리는 중이다.
  const question: CurrentQuestion | null =
    currentQuestion && currentQuestion.id !== answeredQuestionId ? currentQuestion : null;
  // 채팅은 장치 점검 없이 바로 와서 질문 준비(플랜)를 이 화면에서 기다린다.
  const preparing = session.status === "READY" && session.planStatus === "GENERATING";
  const waiting =
    (session.status === "IN_PROGRESS" && question === null) ||
    session.status === "ANALYZING" ||
    preparing;
  // 채팅 질문 준비 실패(5.2 planStatus FAILED) → 5.3으로 다시 준비한다.
  const planFailed = session.status === "READY" && session.planStatus === "FAILED";
  // 5.4 자동 시작. 실패하면 2초 뒤 다시 조회해 다시 시도한다(attempt). 서버가 실패로 답했으면 새 키로
  // (웹 Swagger: 같은 키·같은 본문이면 처음 결과를 그대로 반환). 실패 문구(detail)는 말풍선 아래에 보여 준다.
  const [start, setStart] = useState(() => ({ key: crypto.randomUUID(), attempt: 0 }));
  const startedAttempt = useRef(-1);
  const [startError, setStartError] = useState<string>();
  const [startRetry, setStartRetry] = useState<{ newKey: boolean } | null>(null);

  // 다른 면접에 들어오면 지난 면접의 모달 · 답한 질문 · 레벨업을 지운다.
  // 떠날 때는 지우지 않는다: 5.8의 레벨업(leveledUp)을 결과 화면(S08)까지 기억해야 한다(웹 Swagger leveledUp: 5.8 응답에만 값).
  // 이미 끝낸 면접(S06-1 결과 분석 중)을 새로고침해 들어온 것이면 그 면접의 레벨업이므로 남긴다.
  const [enteredEnded] = useState(analyzing);
  useEffect(() => {
    reset({ keepLeveledUp: enteredEnded });
  }, [reset, enteredEnded]);

  // 채팅: 질문 준비가 끝나면(5.2 planStatus READY) 면접을 자동으로 시작한다(5.4). 별도 대기 화면은 없다.
  // 실패하면(서버 실패 · 연결 오류) 2초 뒤 화면을 다시 그려 5.2로 지금 상태를 받고, 아직 시작 전이면 다시 보낸다.
  useEffect(() => {
    if (session.mode !== "CHAT" || session.status !== "READY" || session.planStatus !== "READY") {
      return;
    }
    if (startedAttempt.current === start.attempt) return;
    startedAttempt.current = start.attempt;
    void startSession(session.id, start.key).then((result) => {
      setStartError(result.formError);
      if (result.formError) setStartRetry({ newKey: Boolean(result.keySpent) });
    });
  }, [session.id, session.mode, session.status, session.planStatus, start]);

  // 자동 시작이 실패했으면 2초 뒤 다시 그려 5.2로 지금 상태를 받고, 다음 시도(attempt)를 연다.
  useEffect(() => {
    if (!startRetry) return;
    const timer = setTimeout(() => {
      router.refresh();
      setStartRetry(null);
      setStart((prev) => ({
        key: startRetry.newKey ? crypto.randomUUID() : prev.key,
        attempt: prev.attempt + 1,
      }));
    }, SESSION_POLL_MS);
    return () => clearTimeout(timer);
  }, [startRetry, router]);

  // 다음 질문 · 결과 분석을 기다리는 동안 2초마다 다시 그려 서버 컴포넌트가 5.2를 다시 부르게 한다.
  // 다시 그리기가 끝난 뒤에 다음 조회를 예약해 요청이 겹치지 않게 한다(S05 질문 준비와 같은 방식).
  // 인터넷이 끊기면 조회를 멈췄다가 다시 연결되면 이어서 한다.
  useEffect(() => {
    if (!waiting || refreshing || !online) return;
    const timer = setTimeout(() => startRefresh(() => router.refresh()), SESSION_POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, refreshing, online, router]);

  return (
    <>
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={
          analyzing ? { opacity: 0.28, filter: "blur(8px)" } : { opacity: 1, filter: "blur(0px)" }
        }
        transition={{ duration: reduce ? 0 : 0.6, ease: "easeInOut" }}
      >
        <InterviewerStage persona={session.persona} />
      </motion.div>

      <AnimatePresence mode="wait">
        {analyzing ? (
          <AnalyzingView key="analyzing" session={session} />
        ) : (
          <motion.div
            key="interview"
            className="absolute inset-0 flex flex-col"
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[200px] bg-gradient-to-b from-[rgba(11,13,20,0.8)] to-[rgba(11,13,20,0)]" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[480px] bg-gradient-to-b from-[rgba(11,13,20,0)] to-[rgba(11,13,20,0.95)]" />
            {interviewerBackdrop(session.persona) === "storm" && (
              <LightningFlash questionId={question?.id ?? null} />
            )}

            <TopBar session={session} question={question} />
            {session.mode === "VIDEO" ? (
              <VideoInterview
                sessionId={session.id}
                interviewer={interviewer}
                question={question}
                answeredCount={session.answeredCount}
              />
            ) : (
              <Dialog bottom="pb-[5px]">
                {planFailed ? (
                  <PlanFailed sessionId={session.id} />
                ) : session.status !== "IN_PROGRESS" ? (
                  <QuestionBubble interviewer={interviewer} question={question} />
                ) : null}
                {startError && session.status === "READY" && (
                  <p role="alert" className="text-[13px] leading-normal font-medium text-[#ff8a8a]">
                    {startError}
                  </p>
                )}
                {session.status === "IN_PROGRESS" ? (
                  <ChatLive sessionId={session.id} question={question} interviewer={interviewer} />
                ) : (
                  <ChatPanel sessionId={session.id} question={question} />
                )}
              </Dialog>
            )}
            <EndModal sessionId={session.id} answeredCount={session.answeredCount} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * 채팅 질문 준비 실패. 말풍선 자리에 S05와 같은 '면접 준비에 실패했어요' + [다시 시도](5.3)를 보여 준다.
 * 5.3이 받아들여지면 화면을 다시 그려(GENERATING) 질문 준비를 다시 기다린다.
 */
function PlanFailed({ sessionId }: { sessionId: number }) {
  const [retrying, startRetry] = useTransition();
  const [error, setError] = useState<string>();

  function retry() {
    setError(undefined);
    startRetry(async () => {
      const result = await retryPlan(sessionId);
      if (result.formError) setError(result.formError);
    });
  }

  return (
    <section
      aria-label="면접 준비"
      className="flex w-full flex-col gap-2 rounded-[20px] border border-white/10 bg-[rgba(14,16,22,0.8)] px-[22px] py-[18px] backdrop-blur-[8px]"
    >
      <div className="flex w-full items-center gap-2">
        <MaskIcon src="/devices/icon-circle-x.svg" size={18} className="bg-[#ff8a8a]" />
        <p className="min-w-0 flex-1 text-base leading-normal font-bold tracking-[-0.2px] text-white">
          면접 준비에 실패했어요
        </p>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm leading-normal font-bold text-white disabled:cursor-default disabled:opacity-60"
        >
          <MaskIcon src="/devices/icon-rotate-cw.svg" size={14} className="bg-white" />
          다시 시도
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] leading-normal font-medium text-[#ff8a8a]">
          {error}
        </p>
      )}
    </section>
  );
}

/** 아래 가운데 대화 영역(Figma Dialog 820) */
function Dialog({ bottom, children }: { bottom: string; children: React.ReactNode }) {
  return (
    <div className={`relative mt-auto flex w-full justify-center px-4 ${bottom}`}>
      <div className="flex w-full max-w-[820px] flex-col items-start gap-3">{children}</div>
    </div>
  );
}

/**
 * S06 화상: 내 카메라 · 질문 말풍선 · 내 답변 자막 · 마이크 · [답변 완료] · 마이크 끊김 토스트.
 * 답변은 에이전트가 듣고 저장한다. [답변 완료]가 받아들여지거나 에이전트가 자동 제출(마지막 말 뒤 7초)을 알리면
 * 그 질문은 내는 중이 되어 2초마다 5.5로 다음 질문을 확인한다. 제출됨(answer.state submitted)을 받으면 면접관이
 * '생각 중'이 된다. 알림을 놓쳐도 다음 질문이 오면 넘어간다(에이전트는 알림을 한 번만 보낸다).
 * 5.2로 답변 5개가 저장된 것이 보이면 면접을 끝낸다(5.8).
 * (API 명세 면접방 메시지 · 화상 답변 끝 판단, 사용자 결정 2026-10-26: 다음 질문은 5.5로 받는다,
 * [답변 완료]는 내 답변 자막이 있을 때만, 마지막 답변 뒤 자동으로 끝내기)
 */
function VideoInterview({
  sessionId,
  interviewer,
  question,
  answeredCount,
}: {
  sessionId: number;
  interviewer: string;
  question: CurrentQuestion | null;
  answeredCount: number;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const online = useOnline();
  const { stream, level } = useInterviewMedia();
  const setAnsweredQuestion = useInterviewStore((state) => state.setAnsweredQuestion);
  const setLeveledUp = useInterviewStore((state) => state.setLeveledUp);
  // [답변 완료]를 보내 에이전트의 응답을 기다리는 중
  const [requesting, setRequesting] = useState(false);
  // 에이전트가 답변을 내는 중인 질문(id)
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  // 답변을 낸 자막 캡처. 에이전트가 다음 답변을 들으려 새 캡처를 열 때까지 지난 답변 글을 감춘다.
  // 내기 시작할 때 정해 두어, 제출됨 알림이 늦거나 오지 않아도 다음 질문 아래에 지난 글이 남지 않는다.
  const [doneStream, setDoneStream] = useState<string | null>(null);
  // 결과 큐에 내지 못한 질문(id). 자막이 없어도(새로고침 뒤) [답변 완료]로 같은 답변을 다시 낼 수 있다(AI 명세 6.5)
  const [failedId, setFailedId] = useState<number | null>(null);
  const [completedSeq, setCompletedSeq] = useState(0);
  const [answerNotice, setAnswerNotice] = useState<AnswerStateMessage | null>(null);

  function startSubmitting(questionId: number) {
    setAnswerNotice(null);
    setSubmittingId(questionId);
    setFailedId(null);
    setDoneStream(stt.streamId);
  }

  function onAnswerState(message: AnswerStateMessage) {
    if (question?.seq !== message.seq) return;
    setAnswerNotice(message);
    if (message.state === "autoSubmitted") startSubmitting(question.id);
    if (message.state === "submitted") {
      setCompletedSeq(message.seq);
      setDoneStream(stt.streamId);
      setAnsweredQuestion(question.id);
    }
    if (message.state === "submitFailed") {
      setSubmittingId(null);
      setFailedId(question.id);
      setDoneStream(null);
    }
  }
  const stt = useInterviewRoom(sessionId, stream, { onAnswerState });
  const liveQuestion =
    stt.question &&
    stt.question.seq > completedSeq &&
    (!question || stt.question.seq >= question.seq)
      ? stt.question
      : null;
  const speechLocked = liveQuestion?.speech === "started";
  // 낸 뒤 같은 질문에 새 자막 캡처가 열리면(낼 글이 없어 에이전트가 다시 듣는다) 다시 답할 수 있다
  const submitting =
    question !== null && submittingId === question.id && stt.streamId === doneStream;
  const fresh = stt.streamId === null || stt.streamId !== doneStream;
  const caption = fresh ? stt : { ...stt, confirmedText: "", interimText: "" };
  const spoke = (caption.confirmedText + caption.interimText).trim() !== "";
  const notice = answerNotice?.seq === (liveQuestion?.seq ?? question?.seq) ? answerNotice : null;
  const submissionFailed = notice?.state === "submitFailed";

  async function submit() {
    if (!question || speechLocked || (liveQuestion && liveQuestion.seq !== question.seq)) return;
    setRequesting(true);
    const result = await stt.submitAnswer(question.seq);
    setRequesting(false);
    if (result === "accepted") startSubmitting(question.id);
  }

  // 내는 중이면 2초마다 다시 그려 5.5로 다음 질문을 확인한다(다시 그리기가 끝난 뒤 다음 조회를 예약한다).
  useEffect(() => {
    if (!submitting || refreshing || !online) return;
    const timer = setTimeout(() => startRefresh(() => router.refresh()), SESSION_POLL_MS);
    return () => clearTimeout(timer);
  }, [submitting, refreshing, online, router]);

  useFinishAfterLastAnswer(sessionId, answeredCount >= TOTAL_QUESTIONS, setLeveledUp);

  return (
    <>
      <SelfCamera stream={stream} />
      <Dialog bottom="pb-[68px]">
        <QuestionBubble interviewer={interviewer} question={liveQuestion ?? question} />
        <AnswerCaption
          {...caption}
          status={notice?.state === "sttFailed" ? "sttFailed" : caption.status}
          onRetry={stt.retry}
        />
        {submissionFailed && (
          <p role="alert" className="text-sm text-[#ff8a8a]">
            답변을 제출하지 못했어요. 다시 시도해 주세요.
          </p>
        )}
        {notice?.state === "timedOut" && !spoke && (
          <p role="status" className="text-sm text-white/70">
            답변을 기다리고 있어요. 말씀을 시작해 주세요.
          </p>
        )}
        <VideoControls
          level={level}
          submitLabel={submissionFailed ? "다시 시도" : "답변 완료"}
          canSubmit={
            question !== null &&
            (!liveQuestion || liveQuestion.seq === question.seq) &&
            !speechLocked &&
            (spoke || failedId === question.id) &&
            !submitting &&
            !requesting
          }
          submitting={submitting || requesting}
          onSubmit={() => void submit()}
        />
      </Dialog>
      <MicToast level={level} />
    </>
  );
}

/**
 * 화상 답변이 모두 저장되면(ready) 면접을 끝낸다(5.8). 실패하면 2초 뒤 다시 보낸다.
 * 같은 끝내기는 같은 멱등 키로 보내고, 서버가 실패로 답했으면 새 키로 보낸다(채팅 마지막 답변과 같음).
 */
function useFinishAfterLastAnswer(
  sessionId: number,
  ready: boolean,
  setLeveledUp: (leveledUp: boolean | null) => void,
) {
  const key = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sent = useRef(-1);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(retry.current), []);

  useEffect(() => {
    if (!ready || sent.current === attempt) return;
    sent.current = attempt;
    key.current ??= crypto.randomUUID();
    void endSession(sessionId, key.current).then((ended) => {
      if (ended.keySpent) key.current = null;
      if (!ended.formError) {
        setLeveledUp(ended.leveledUp ?? null);
        return;
      }
      retry.current = setTimeout(() => setAttempt((value) => value + 1), SESSION_POLL_MS);
    });
  }, [ready, attempt, sessionId, setLeveledUp]);
}

/**
 * S06-B 채팅 면접 중: 5.14로 입장 정보를 받아 송출 없이 면접방에 들어가 면접관 음성을 듣고,
 * 답변이 저장되면(5.7) 에이전트에 [답변 완료](answer.submit)를 보내 다음 질문으로 넘긴다
 * (웹 Swagger 5.4: 채팅도 면접방에 들어간다(송출 없이 수신·메시지만) · API 명세 5.7 · 면접방 메시지
 * · 사용자 결정 2026-10-26: 화상과 같이 5.14로 입장, 연결 실패는 표시 없이 진행).
 * 연결이 끊기거나(SDK가 다시 잇기를 포기) 5.14가 실패하면 2초 뒤 다시 들어가고, 연달아 3번까지만 한다. 들어가면 횟수를 처음부터
 * 다시 센다(사용자 결정 2026-10-26). [답변 완료]를 보내지 못하면(아직 입장 전 · 끊김) 에이전트가 받거나 거절할 때까지 2초마다 다시 보낸다.
 */
function ChatLive({
  sessionId,
  question,
  interviewer,
}: {
  sessionId: number;
  question: CurrentQuestion | null;
  interviewer: string;
}) {
  const {
    status,
    retry,
    submitAnswer,
    question: message,
    sendChatInput,
  } = useInterviewRoom(sessionId, null, { listenOnly: true });
  const [completedSeq, setCompletedSeq] = useState(0);
  const liveQuestion =
    message && message.seq > completedSeq && (!question || message.seq >= question.seq)
      ? message
      : null;
  const submissionLocked =
    liveQuestion?.speech === "started" ||
    (liveQuestion !== null && liveQuestion.seq !== question?.seq);
  const inputQuestionSeq = liveQuestion?.seq ?? question?.seq;
  const sendInput = useCallback(
    (questionSeq: number, seq: number, text: string, pauseMs: number) => {
      if (questionSeq !== inputQuestionSeq) return;
      void sendChatInput(questionSeq, seq, text, pauseMs);
    },
    [inputQuestionSeq, sendChatInput],
  );
  const router = useRouter();
  // 질문 글은 메시지로 표시하되 저장에 필요한 질문 ID는 같은 순서의 BE 응답으로 확인한다.
  useEffect(() => {
    if (!liveQuestion || liveQuestion.seq === question?.seq) return;
    const timer = setTimeout(() => router.refresh(), SESSION_POLL_MS);
    return () => clearTimeout(timer);
  }, [liveQuestion, question, router]);
  const [retries, setRetries] = useState(0);
  if (status === "listening" && retries !== 0) setRetries(0);

  useEffect(() => {
    if (status !== "failed" || retries >= CHAT_ROOM_RETRIES) return;
    const timer = setTimeout(() => {
      setRetries((count) => count + 1);
      retry();
    }, CHAT_ROOM_RETRY_MS);
    return () => clearTimeout(timer);
  }, [status, retries, retry]);

  // 보내지 못한 [답변 완료]. attempt는 같은 질문을 다시 보낼 때마다 늘려 다시 예약하게 한다.
  const [unsent, setUnsent] = useState<{ seq: number; attempt: number } | null>(null);
  // 가장 최근에 보낸 질문 순서. 지난 질문의 늦은 결과가 다음 질문의 재전송 예약을 지우지 않게 한다.
  const latest = useRef(0);
  const send = useCallback(
    async (seq: number, attempt: number) => {
      latest.current = Math.max(latest.current, seq);
      const result = await submitAnswer(seq);
      if (seq < latest.current) return;
      setUnsent(result === "failed" ? { seq, attempt: attempt + 1 } : null);
    },
    [submitAnswer],
  );
  useEffect(() => {
    if (!unsent) return;
    const timer = setTimeout(() => void send(unsent.seq, unsent.attempt), CHAT_ROOM_RETRY_MS);
    return () => clearTimeout(timer);
  }, [unsent, send]);

  return (
    <>
      <QuestionBubble interviewer={interviewer} question={liveQuestion ?? question} />
      <ChatPanel
        sessionId={sessionId}
        question={question}
        submissionLocked={submissionLocked}
        onChatInput={sendInput}
        inputQuestionSeq={inputQuestionSeq}
        onAnswered={(seq) => {
          setCompletedSeq(seq);
          void send(seq, 0);
        }}
      />
    </>
  );
}

/** 질문이 바뀔 때만 번개처럼 깜빡이는 빛(악마 면접관 배경). 처음 화면에 들어올 때는 깜빡이지 않는다. */
function LightningFlash({ questionId }: { questionId: number | null }) {
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const previous = useRef(questionId);

  useEffect(() => {
    if (questionId === null || questionId === previous.current) return;
    previous.current = questionId;
    if (reduce) return;
    void animate(scope.current, { opacity: [1, 0, 1, 0.2, 1] }, { duration: 0.6, ease: "linear" });
  }, [questionId, reduce, animate, scope]);

  return (
    <div
      ref={scope}
      data-testid="lightning-flash"
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_50%_at_72%_12%,rgba(185,212,255,0.18),rgba(185,212,255,0))]"
    />
  );
}
