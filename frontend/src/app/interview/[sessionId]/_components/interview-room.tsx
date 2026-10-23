"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { InterviewerStage } from "@/components/interview/interviewer-stage";
import { useOnline } from "@/components/use-online";
import { MaskIcon } from "@/components/mask-icon";
import { retryPlan, startSession } from "@/lib/interview/actions";
import { PERSONAS } from "@/lib/interview/personas";
import { interviewerBackdrop } from "@/lib/interviewer/models";
import { useInterviewStore } from "@/stores/interview-store";
import type { CurrentQuestion, SessionResponse } from "@/types/api";

import { AnalyzingView } from "./analyzing-view";
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
// (채팅: 질문 준비가 끝나면 화면이 자동으로 부른다) · 5.3 면접 플랜 재생성
// · 사용자 결정(2026-10-22: 준비 실패 문구는 '면접 준비에 실패했어요' + [다시 시도], S05와 같음)
// · 웹 Swagger 5.2 · 5.5(서버 작업이 끝났는지는 2초마다(임시 값) 다시 불러 확인 — 다음 질문은 5.5, 질문 준비 · 결과 분석은 5.2)

/** 다음 질문 · 결과 분석을 다시 조회하는 간격(웹 Swagger 5.2 · 5.5 "2초마다(임시 값)") */
export const SESSION_POLL_MS = 2000;

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
              <VideoInterview interviewer={interviewer} question={question} />
            ) : (
              <Dialog bottom="pb-[5px]">
                {planFailed ? (
                  <PlanFailed sessionId={session.id} />
                ) : (
                  <QuestionBubble interviewer={interviewer} question={question} />
                )}
                {startError && session.status === "READY" && (
                  <p role="alert" className="text-[13px] leading-normal font-medium text-[#ff8a8a]">
                    {startError}
                  </p>
                )}
                <ChatPanel sessionId={session.id} question={question} />
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

/** S06 화상: 내 카메라 · 질문 말풍선 · 마이크 · 마이크 끊김 토스트 */
function VideoInterview({
  interviewer,
  question,
}: {
  interviewer: string;
  question: CurrentQuestion | null;
}) {
  const { stream, level } = useInterviewMedia();
  return (
    <>
      <SelfCamera stream={stream} />
      <Dialog bottom="pb-[68px]">
        <QuestionBubble interviewer={interviewer} question={question} />
        <VideoControls level={level} />
      </Dialog>
      <MicToast level={level} />
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
