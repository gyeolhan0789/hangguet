"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";

import { InterviewerStage } from "@/components/interview/interviewer-stage";
import { useGazeTracker } from "@/components/interview/use-gaze-tracker";
import {
  useInterviewRoom,
  type InterviewRoomStatus,
  type RoomPresentation,
} from "@/components/interview/use-interview-room";
import { extendTurn, saveAnswerDraft } from "@/lib/group/actions";
import { endSession } from "@/lib/interview/actions";
import { useDuckAmbience } from "@/lib/interview/duck-ambience";
import { hasDuckCall, playDuckCall, preloadDuckCall } from "@/lib/interview/duck-call";
import { gazeRatio } from "@/lib/interview/gaze";
import { PERSONAS } from "@/lib/interview/personas";
import type { AnswerStateMessage, RoomInfoSnapshot } from "@/lib/interview/room-messages";
import { interviewerBackdrop } from "@/lib/interviewer/models";
import { useGazeStore } from "@/stores/gaze-store";
import { useInterviewStore } from "@/stores/interview-store";
import type {
  CurrentQuestion,
  ParticipantResponse,
  Persona,
  RoomInfo,
  SessionResponse,
} from "@/types/api";

import { AnalyzingView } from "./analyzing-view";
import { AnswerCaption } from "./answer-caption";
import { AttitudeTile } from "./attitude-tile";
import { ChatPanel } from "./chat-panel";
import { EndModal } from "./end-modal";
import {
  COUNTDOWN_SECONDS,
  describeTurn,
  EXTEND_WITHIN_SECONDS,
  formatRemaining,
  GROUP_BASE_QUESTIONS,
  useRemainingSeconds,
} from "./group-turn";
import {
  answerNoticeText,
  Dialog,
  LightningFlash,
  SESSION_POLL_MS,
  useLeaveConfirm,
  useRefreshWhile,
} from "./interview-room";
import { MicCheckModal } from "./mic-check-modal";
import { QuestionBubble, ShowUiButton } from "./question-bubble";
import {
  GroupAiFailureModal,
  PAUSE_AFTER_MS,
  PausedModal,
  ReconnectBanner,
  useReconnectSeconds,
} from "./room-alerts";
import { TopBar } from "./top-bar";
import { useInterviewMedia } from "./use-interview-media";
import { AnswerNotice, MicToast, SelfCamera, VideoControls } from "./video-panel";

// 기준: API 명세 10.10 그룹 세션의 기존 API 규칙(5.5 지금 질문 · 5.7 isLastQuestion은 늘 false · 그룹 채팅은 answer.submit을 보내지
// 않는다 · 5.8 내 면접만 끝낸다 · '질문 n / 5' 대신 기본 질문 4개 기준) · 10.11 그룹 면접방 정보 · 메시지
// · BE Swagger 10.8 답변 시간 연장 · 10.9 작성 중인 답변 저장 · API 명세 10.9 · 그룹 설계 6.7(입력이 0.8초 멈출 때마다 최소 5초 간격
// · 창을 벗어날 때 · sessionStorage 복구) · API 명세 10.4 · 그룹 설계 6.5(면접방 정보를 3초 넘게 받지 못하면 10.4로 한 번 맞춘다)
// · 그룹 설계 2장(답변 2분 · 30초 이하 1분 연장 1회 · 종료 10초 전 카운트다운) · 6.8 음성 간섭(차례가 아닌 사람에게 마이크를 끄라고
// 안내하고 한 번 눌러 끄게 한다) · 6.11 AI 장애 · Figma S06 화상 · S06-B 채팅(그룹 면접방 화면은 Figma에 없어 S06을 그대로 쓴다)
// · 사용자 결정(2026-11-12: 차례 · 남은 시간 · 진행은 위 가운데 진행 알약 자리 · 2026-11-13 빈칸 기본안: 단계 문구 · 내 차례에 마이크를
// 다시 켬 · 채팅은 내 차례가 아니면 입력을 잠금 · AI 장애는 제목만)

/** 작성 중인 답변 저장 최소 간격(API 명세 10.9 '최소 5초 간격') */
const DRAFT_MIN_INTERVAL_MS = 5000;
/** 면접방에 들어간 뒤 방 정보를 이만큼 받지 못하면 10.4로 한 번 맞춘다(API 명세 10.4 '3초 넘게 받지 못했을 때만 한 번') */
export const ROOM_INFO_WAIT_MS = 3000;

export function GroupInterviewRoom({
  session,
  currentQuestion,
  members: receivedMembers,
  turn: receivedTurn,
}: Readonly<{
  session: SessionResponse;
  /** 5.5 내 지금 질문(내 질문을 모두 마쳤으면 null) */
  currentQuestion: CurrentQuestion | null;
  /** 10.4 참가자(닉네임). 면접방 정보에는 면접 id만 있다. BE가 잠깐 답하지 못했으면 undefined(직전 값을 둔다) */
  members: readonly ParticipantResponse[] | undefined;
  /** 10.4 turn(면접방 정보와 같은 차례 정보). 면접방 정보를 받기 전에만 쓴다. 받지 못했으면 undefined(직전 값을 둔다) */
  turn?: RoomInfo | null;
}>) {
  // 다시 그릴 때 10.4가 잠깐 실패해도(배포 중 502 등) 직전에 받은 닉네임 · 차례로 계속 그린다
  const [kept, setKept] = useState({ members: receivedMembers ?? [], turn: receivedTurn ?? null });
  if (
    (receivedMembers !== undefined && receivedMembers !== kept.members) ||
    (receivedTurn !== undefined && receivedTurn !== kept.turn)
  ) {
    setKept({
      members: receivedMembers ?? kept.members,
      turn: receivedTurn === undefined ? kept.turn : receivedTurn,
    });
  }
  const { members, turn } = kept;
  const reduce = useReducedMotion();
  const reset = useInterviewStore((state) => state.reset);
  const uiHidden = useInterviewStore((state) => state.uiHidden);
  const [presentation, setPresentation] = useState<RoomPresentation | null>(null);
  const analyzing = session.status === "ANALYZING" || session.status === "COMPLETED";
  const [enteredEnded] = useState(analyzing);
  // S06과 같다: 들어오면 지난 면접의 모달 · 레벨업을 지운다(이미 끝낸 면접에 다시 들어오면 레벨업은 남긴다)
  useLayoutEffect(() => {
    reset({ keepLeveledUp: enteredEnded });
  }, [reset, enteredEnded]);
  // S06과 같다: 오리 면접관 배경음 · 결과 분석 다시 조회 · 탭을 닫을 때 확인
  useDuckAmbience(hasDuckCall(session.persona) && !analyzing);
  useRefreshWhile(session.status === "ANALYZING");
  useLeaveConfirm(session.status === "IN_PROGRESS");

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
        <InterviewerStage
          persona={session.persona}
          feedback={analyzing ? null : presentation?.reaction}
          speaking={presentation?.question?.speech === "started"}
          listening={analyzing ? null : presentation?.listening}
          question={analyzing ? null : presentation?.question}
        />
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
              // 질문이 바뀔 때만 번개처럼 깜빡인다(모션 메모 S06). 그룹은 답변자 · 질문 순서가 바뀔 때다
              <LightningFlash
                questionId={presentation?.question ? questionKey(presentation.question) : null}
              />
            )}
            {session.mode === "VIDEO" ? (
              <GroupVideo
                session={session}
                currentQuestion={currentQuestion}
                members={members}
                fallbackRoom={turn}
                uiHidden={uiHidden}
                onPresentation={setPresentation}
              />
            ) : (
              <GroupChat
                session={session}
                currentQuestion={currentQuestion}
                members={members}
                fallbackRoom={turn}
                uiHidden={uiHidden}
                onPresentation={setPresentation}
              />
            )}
            <ShowUiButton />
            <EndModal
              sessionId={session.id}
              answeredCount={session.answeredCount}
              video={session.mode === "VIDEO"}
              group
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** 질문 하나를 가리키는 수(답변자 면접 id · 질문 순서). 번개 연출이 '질문이 바뀌었는지'를 이것으로 본다 */
const questionKey = (question: { sessionId: number; seq: number }) =>
  question.sessionId * 10 + question.seq;

/**
 * 면접방 정보(10.11). 받기 전이면 10.4 turn으로 채우고, 들어간 뒤 3초가 지나도 받지 못하면 한 번 다시 그려 10.4를 다시 받는다
 * (API 명세 10.4 · 그룹 설계 6.5). 10.4 turn의 시각 보정은 하지 않는다(면접방 정보를 받으면 그것으로 바뀐다).
 */
function useRoomInfo(
  live: RoomInfoSnapshot | null,
  fallback: RoomInfo | null,
  status: InterviewRoomStatus,
): RoomInfoSnapshot | null {
  const router = useRouter();
  const missing = live === null && (status === "listening" || status === "sttFailed");
  useEffect(() => {
    if (!missing) return;
    const timer = setTimeout(() => router.refresh(), ROOM_INFO_WAIT_MS);
    return () => clearTimeout(timer);
  }, [missing, router]);
  return live ?? (fallback && { info: fallback, offsetMs: 0 });
}

/**
 * 화상 · 채팅 공통 진행.
 * - S06-F와 같이 끊기면 배너 · 잠시 멈춤 카드. 내 질문을 다 마쳤거나(DONE · ENDED) 그룹이 끝났으면 BE가 방에서 내보내므로 끊김으로 보지 않고,
 *   다시 잇기를 포기했으면 다시 그려 5.2로 상태를 확인한다
 * - 내 상태가 DONE이면 5.8로 내 면접만 끝낸다(10.10). 화상은 잰 시선 비율을 함께 보낸다(S06과 같다)
 * - 면접관 장애로 끝났으면(10.11 endReason AI_FAILURE) 먼저 알리고, 그 밖에 내 면접 · 그룹이 끝나면 다시 그려 결과 분석 · 홈을 정한다
 * - 내 차례인데 5.5 질문이 아직 그 차례가 아니면 2초마다 다시 그린다. [면접 종료]를 열면 답변 수(5.2)를 한 번 다시 받는다
 */
function useGroupProgress({
  session,
  room,
  status,
  currentQuestion,
}: {
  session: SessionResponse;
  room: RoomInfoSnapshot | null;
  status: InterviewRoomStatus;
  currentQuestion: CurrentQuestion | null;
}) {
  const router = useRouter();
  const setLeveledUp = useInterviewStore((state) => state.setLeveledUp);
  const endOpen = useInterviewStore((state) => state.endOpen);
  const info = room?.info;
  const me = info?.participants.find((participant) => participant.sessionId === session.id);
  const turn = info?.turn ?? null;
  const groupEnded = info?.groupStatus === "ENDED";
  const watching = me?.state !== "DONE" && me?.state !== "ENDED" && !groupEnded;

  const reconnectSeconds = useReconnectSeconds(status === "reconnecting");
  const disconnected = watching && status === "failed";
  const paused = disconnected || (watching && reconnectSeconds * 1000 >= PAUSE_AFTER_MS);
  useEffect(() => {
    if (disconnected) router.refresh();
  }, [disconnected, router]);

  // 같은 끝내기는 같은 멱등 키 · 같은 시선 비율로 다시 보내고, 서버가 실패로 답했으면 새 키로 보낸다(S06 마지막 답변 뒤 끝내기와 같다)
  const endKey = useRef<{ value: string; gazeRatio: number | null } | null>(null);
  const [endAttempt, setEndAttempt] = useState(0);
  const sentAttempt = useRef(-1);
  const done = me?.state === "DONE";
  const video = session.mode === "VIDEO";
  useEffect(() => {
    if (!done || sentAttempt.current === endAttempt) return;
    sentAttempt.current = endAttempt;
    endKey.current ??= {
      value: crypto.randomUUID(),
      gazeRatio: video ? gazeRatio(useGazeStore.getState().frames) : null,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    void endSession(session.id, endKey.current.value, endKey.current.gazeRatio).then((ended) => {
      if (ended.keySpent) endKey.current = null;
      if (!ended.formError) {
        setLeveledUp(ended.leveledUp ?? null);
        return;
      }
      timer = setTimeout(() => setEndAttempt((value) => value + 1), SESSION_POLL_MS);
    });
    return () => clearTimeout(timer);
  }, [done, endAttempt, session.id, video, setLeveledUp]);

  const aiFailed =
    me?.endReason === "AI_FAILURE" ||
    (groupEnded && info.participants.some((participant) => participant.endReason === "AI_FAILURE"));
  const finished = !aiFailed && (me?.state === "ENDED" || groupEnded);
  useEffect(() => {
    if (finished) router.refresh();
  }, [finished, router]);

  useEffect(() => {
    if (endOpen) router.refresh();
  }, [endOpen, router]);

  const behind =
    turn?.sessionId === session.id &&
    (info?.phase === "ANSWERING" || info?.phase === "SPEAKING") &&
    currentQuestion?.seq !== turn.seq;
  useRefreshWhile(behind);

  return {
    reconnectSeconds,
    reconnecting: watching && status === "reconnecting" && !paused,
    paused,
    aiFailed,
    confirmAiFailure: () => router.refresh(),
  };
}

/** 끊김 배너 · 잠시 멈춤 카드 · 면접관 장애 안내(화상 · 채팅 같다) */
function ConnectionAlerts({
  progress,
  retry,
}: Readonly<{ progress: ReturnType<typeof useGroupProgress>; retry: () => void }>) {
  const openEnd = useInterviewStore((state) => state.openEnd);
  const endOpen = useInterviewStore((state) => state.endOpen);
  return (
    <>
      <AnimatePresence>
        {/* 재연결 안내는 화면을 숨긴 동안에도 보인다(S06과 같다) */}
        {progress.reconnecting && <ReconnectBanner seconds={progress.reconnectSeconds} />}
      </AnimatePresence>
      <PausedModal
        open={progress.paused && !endOpen && !progress.aiFailed}
        onEnd={openEnd}
        onRetry={retry}
      />
      <GroupAiFailureModal open={progress.aiFailed} onConfirm={progress.confirmAiFailure} />
    </>
  );
}

/**
 * 위 가운데 진행 알약 안(S06 '질문 3 / 5' · 경과 시간 자리): '질문 n / 4' · 단계 문구 · 답변 남은 시간(10초 이하 빨강) · [+1분].
 * 읽기 프로그램에는 단계 문구를 알리고, 남은 시간은 매초 읽지 않고 내 차례에 10초가 남았을 때 한 번 알린다.
 */
function TurnPill({
  room,
  mySessionId,
  members,
  extend,
}: Readonly<{
  room: RoomInfoSnapshot | null;
  mySessionId: number;
  members: readonly ParticipantResponse[];
  /** 화상 내 차례의 답변 시간 연장(10.8). 채팅은 없다 */
  extend?: { pending: boolean; onExtend: () => void };
}>) {
  const { info, turn, myTurn, label } = describeTurn(room, mySessionId, members);
  const remaining = useRemainingSeconds(
    info?.phase === "ANSWERING" ? (turn?.deadlineAt ?? null) : null,
    room?.offsetMs ?? 0,
  );
  // 꼬리질문(baseIndex null)은 직전 기본 질문 번호를 그대로 둔다
  const [baseIndex, setBaseIndex] = useState(turn?.baseIndex ?? null);
  if (turn?.baseIndex != null && turn.baseIndex !== baseIndex) setBaseIndex(turn.baseIndex);
  const urgent = remaining !== null && remaining <= COUNTDOWN_SECONDS;
  const canExtend =
    extend !== undefined &&
    myTurn &&
    remaining !== null &&
    remaining > 0 &&
    remaining <= EXTEND_WITHIN_SECONDS &&
    turn?.extended === false;

  return (
    <>
      {baseIndex !== null && (
        <span className="shrink-0 text-[15px] leading-normal font-bold whitespace-nowrap text-white">
          질문 {baseIndex} / {GROUP_BASE_QUESTIONS}
        </span>
      )}
      <span
        aria-live="polite"
        className={`min-w-0 truncate text-[15px] leading-normal font-semibold ${myTurn ? "text-brand" : "text-white/70"}`}
      >
        {label}
      </span>
      {remaining !== null && (
        <time
          aria-hidden
          className={`shrink-0 text-[15px] leading-normal font-semibold tabular-nums ${urgent ? "text-[#ff8a8a]" : "text-white/70"}`}
        >
          {formatRemaining(remaining)}
        </time>
      )}
      <span className="sr-only" aria-live="assertive">
        {myTurn && urgent ? `답변 시간이 ${COUNTDOWN_SECONDS}초 남았어요` : ""}
      </span>
      {canExtend && (
        <button
          type="button"
          disabled={extend.pending}
          onClick={extend.onExtend}
          className="shrink-0 cursor-pointer rounded-full bg-brand-strong px-2.5 py-1 text-[13px] leading-normal font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          +1분
        </button>
      )}
    </>
  );
}

/** 오리 면접관이면 효과음을 미리 받아 두고, 답변을 낼 때 감탄(소리 · 놀람 동작)을 낸다(S06과 같다). 아니면 null */
function useDuckExclaim(persona: Persona) {
  const duckCall = hasDuckCall(persona);
  const exclaim = useInterviewStore((state) => state.exclaim);
  useEffect(() => {
    if (duckCall) preloadDuckCall();
  }, [duckCall]);
  if (!duckCall) return null;
  return () => {
    playDuckCall();
    exclaim();
  };
}

/**
 * 화상 그룹 면접: S06 처리를 그대로 쓰되 내 차례(10.11 turn.sessionId)일 때만 답변 자막 · [답변 완료]를 둔다.
 * 답변 상태(answer.state)는 내 질문의 것만 오고, 내는 중 · 제출 실패 · [다시 시도]는 S06과 같다.
 * 내 차례가 아니면 마이크를 끄라고 안내하고 [마이크 끄기]로 끄게 하며, 내 차례가 되면 다시 켠다(그룹 설계 6.8).
 */
function GroupVideo({
  session,
  currentQuestion,
  members,
  fallbackRoom,
  uiHidden,
  onPresentation,
}: Readonly<{
  session: SessionResponse;
  currentQuestion: CurrentQuestion | null;
  members: readonly ParticipantResponse[];
  fallbackRoom: RoomInfo | null;
  uiHidden: boolean;
  onPresentation: (value: RoomPresentation | null) => void;
}>) {
  const { stream, level, unavailable } = useInterviewMedia();
  const duckExclaim = useDuckExclaim(session.persona);
  const [requesting, setRequesting] = useState(false);
  // 답변을 내는 중인 내 질문 순서 · 그때의 자막 캡처(새 캡처가 열리면 다시 답할 수 있다, S06과 같다)
  const [submittingSeq, setSubmittingSeq] = useState<number | null>(null);
  const [doneStream, setDoneStream] = useState<string | null>(null);
  const [failedSeq, setFailedSeq] = useState<number | null>(null);
  const [answerNotice, setAnswerNotice] = useState<AnswerStateMessage | null>(null);
  const [micCheckOpen, setMicCheckOpen] = useState(false);

  function startSubmitting(seq: number) {
    setAnswerNotice(null);
    setSubmittingSeq(seq);
    setFailedSeq(null);
    setDoneStream(stt.streamId);
  }

  function onAnswerState(message: AnswerStateMessage) {
    setAnswerNotice(message);
    if (message.state === "autoSubmitted") {
      startSubmitting(message.seq);
      duckExclaim?.();
    }
    if (message.state === "submitted") setDoneStream(stt.streamId);
    if (message.state === "submitFailed") {
      setSubmittingSeq(null);
      setFailedSeq(message.seq);
      setDoneStream(null);
    }
  }
  const stt = useInterviewRoom(session.id, stream, { group: true, onAnswerState, onPresentation });
  // 면접 동안 시선을 잰다. 끝낼 때(5.8) 비율만 보낸다(S06과 같다)
  useGazeTracker(stream, stt.sendFrame, session.id);
  const room = useRoomInfo(stt.roomInfo, fallbackRoom, stt.status);
  const progress = useGroupProgress({ session, room, status: stt.status, currentQuestion });
  const { info, turn, myTurn } = describeTurn(room, session.id, members);
  const mySeq = myTurn ? (turn?.seq ?? null) : null;
  const speechLocked = myTurn && info?.phase === "SPEAKING";
  const submitting = mySeq !== null && submittingSeq === mySeq && stt.streamId === doneStream;
  const fresh = stt.streamId === null || stt.streamId !== doneStream;
  const caption = fresh ? stt : { ...stt, confirmedText: "", interimText: "" };
  const spoke = (caption.confirmedText + caption.interimText).trim() !== "";
  const answering = myTurn && info?.phase === "ANSWERING" && !submitting && !requesting;
  const canSubmit = answering && (spoke || failedSeq === mySeq);
  const notice = mySeq !== null && answerNotice?.seq === mySeq ? answerNotice : null;
  const noticeMessage = answerNoticeText({
    savingLast: false,
    notice: notice?.state,
    sttFailed: myTurn && stt.status === "sttFailed",
    spoke,
  });
  const extension = useExtend(session.group?.groupId ?? null, turn);
  const micMute = useMicMute(stream, myTurn);
  const interviewer = PERSONAS.find((persona) => persona.persona === session.persona)?.name ?? "";
  const reaction = stt.reaction?.message;
  const interrupt =
    reaction?.interrupt &&
    reaction.sessionId === turn?.sessionId &&
    reaction.questionSeq === turn.seq
      ? reaction.interrupt.text
      : null;

  /** [답변 완료] · [다시 시도](retry). 오리 면접관은 [답변 완료]가 받아들여지면 호응 효과음을 낸다([다시 시도]는 내지 않는다) */
  async function submit(retry = false) {
    if (mySeq === null || !canSubmit) return;
    setRequesting(true);
    const result = await stt.submitAnswer(mySeq);
    setRequesting(false);
    if (result !== "accepted") return;
    startSubmitting(mySeq);
    if (!retry) duckExclaim?.();
  }

  return (
    <>
      <TopBar
        session={session}
        question={currentQuestion}
        uiHidden={uiHidden}
        center={
          <TurnPill
            room={room}
            mySessionId={session.id}
            members={members}
            extend={{ pending: extension.pending, onExtend: extension.extend }}
          />
        }
      />
      <div className={uiHidden ? "hidden" : "contents"}>
        <SelfCamera stream={stream} />
        <AttitudeTile samples={stt.attitude} answering={answering} />
      </div>
      <ConnectionAlerts progress={progress} retry={stt.retry} />
      <Dialog bottom="pb-[68px]" hidden={uiHidden}>
        {myTurn && extension.error && <AnswerNotice message={extension.error} assertive />}
        {myTurn && noticeMessage && (
          <AnswerNotice
            message={noticeMessage}
            action={
              notice?.state === "submitFailed"
                ? { label: "다시 시도", onClick: () => void submit(true), disabled: !canSubmit }
                : undefined
            }
          />
        )}
        {!myTurn && info?.phase && micMute.available && !micMute.muted && (
          <AnswerNotice
            // 그룹 설계 6.8 · API 명세 10.11 '마이크를 꺼 주세요' 안내
            message="마이크를 꺼 주세요"
            assertive={false}
            action={{ label: "마이크 끄기", onClick: micMute.mute }}
          />
        )}
        <QuestionBubble
          interviewer={interviewer}
          question={stt.question ?? (myTurn ? currentQuestion : null)}
        />
        {interrupt && <output className="block text-sm text-white">{interrupt}</output>}
        {myTurn && (
          <AnswerCaption
            status={caption.status}
            confirmedText={caption.confirmedText}
            interimText={caption.interimText}
            locked={speechLocked}
          >
            <VideoControls
              level={level}
              canSubmit={canSubmit}
              submitting={submitting || requesting}
              locked={speechLocked}
              onSubmit={() => void submit()}
            />
          </AnswerCaption>
        )}
      </Dialog>
      <div className={uiHidden ? "hidden" : "contents"}>
        <MicToast
          level={level}
          answering={answering}
          unavailable={unavailable}
          onCheck={() => setMicCheckOpen(true)}
        />
      </div>
      <MicCheckModal
        open={micCheckOpen}
        onClose={() => setMicCheckOpen(false)}
        stream={stream}
        level={level}
        onPauseSending={stt.pauseMicrophone}
      />
    </>
  );
}

/** 10.8 답변 시간 연장. 실패하면 서버 문구를 두고, 차례가 바뀌면 지운다 */
function useExtend(groupId: number | null, turn: { sessionId: number; seq: number } | null) {
  const [pending, startExtending] = useTransition();
  const [error, setError] = useState<string>();
  const turnKey = turn ? `${turn.sessionId}:${turn.seq}` : null;
  const [errorTurn, setErrorTurn] = useState(turnKey);
  if (errorTurn !== turnKey) {
    setErrorTurn(turnKey);
    setError(undefined);
  }
  const extend = () => {
    if (groupId === null) return;
    startExtending(async () => {
      setError(undefined);
      const result = await extendTurn(groupId);
      if (!result.ok) setError(result.formError);
    });
  };
  return { pending, error, extend };
}

/**
 * 내 차례가 아닐 때 [마이크 끄기]로 내 마이크 트랙을 끈다(그룹 설계 6.8: 안내를 띄우고 한 번 눌러 끄게 한다. 서버가 강제로 끄지 않는다).
 * 내 차례가 되면 다시 켠다(사용자 결정 2026-11-13, 빈칸 기본안: 끈 채로 답하지 않게).
 */
function useMicMute(stream: MediaStream | null, myTurn: boolean) {
  const track = stream?.getAudioTracks()[0];
  // 끈 트랙. 내 차례가 되거나 마이크를 다시 받아 트랙이 바뀌면(새 트랙은 켜져 있다) 끈 것이 아니다
  const [mutedTrack, setMutedTrack] = useState<MediaStreamTrack | null>(null);
  const muted = mutedTrack !== null && mutedTrack === track;
  if (myTurn && mutedTrack !== null) setMutedTrack(null);
  useEffect(() => {
    if (myTurn && track) setTrackEnabled(track, true);
  }, [myTurn, track]);
  const mute = useCallback(() => {
    if (!track) return;
    setTrackEnabled(track, false);
    setMutedTrack(track);
  }, [track]);
  return { muted, available: Boolean(track), mute };
}

/** 마이크 트랙을 켜고 끈다(트랙 주인은 useInterviewMedia라 멈추지 않고 소리만 막는다) */
function setTrackEnabled(track: MediaStreamTrack, enabled: boolean) {
  track.enabled = enabled;
}

/**
 * 채팅 그룹 면접: S06-B 입력창을 늘 두고, 내 차례(질문 음성 · 답변 중)에 5.5 질문이 그 차례와 같을 때만 쓸 수 있다
 * (사용자 결정 2026-11-13, 빈칸 기본안: 내 차례가 아니면 입력을 잠근다). 질문 음성 중에는 쓰기만 하고 내기는 잠근다.
 * 낸 답변은 5.7로만 내고 에이전트에 answer.submit을 보내지 않는다(10.10). 작성 중인 글은 10.9로 저장한다.
 */
function GroupChat({
  session,
  currentQuestion,
  members,
  fallbackRoom,
  uiHidden,
  onPresentation,
}: Readonly<{
  session: SessionResponse;
  currentQuestion: CurrentQuestion | null;
  members: readonly ParticipantResponse[];
  fallbackRoom: RoomInfo | null;
  uiHidden: boolean;
  onPresentation: (value: RoomPresentation | null) => void;
}>) {
  const stt = useInterviewRoom(session.id, null, {
    listenOnly: true,
    group: true,
    onPresentation,
  });
  const room = useRoomInfo(stt.roomInfo, fallbackRoom, stt.status);
  const progress = useGroupProgress({ session, room, status: stt.status, currentQuestion });
  const duckExclaim = useDuckExclaim(session.persona);
  const { info, turn, myTurn } = describeTurn(room, session.id, members);
  const answering = myTurn && info?.phase === "ANSWERING";
  const myQuestion =
    myTurn && (info?.phase === "SPEAKING" || answering) && currentQuestion?.seq === turn?.seq
      ? currentQuestion
      : null;
  const interviewer = PERSONAS.find((persona) => persona.persona === session.persona)?.name ?? "";
  const draft = useAnswerDraft(session.id, myQuestion?.id ?? null, answering);
  // 입력칸은 내 질문이 바뀔 때만 새로 그린다(그 질문의 작성 중인 글로 시작). 답을 낸 뒤 차례가 넘어가도 그대로 둬 보낸 답변 연출이 이어진다
  const [panelKey, setPanelKey] = useState(myQuestion?.id ?? null);
  if (myQuestion && myQuestion.id !== panelKey) setPanelKey(myQuestion.id);

  const { sendChatInput } = stt;
  const { save } = draft;
  const onChatInput = useCallback(
    (questionSeq: number, seq: number, text: string, pauseMs: number) => {
      void sendChatInput(questionSeq, seq, text, pauseMs);
      save(text);
    },
    [sendChatInput, save],
  );

  return (
    <>
      <TopBar
        session={session}
        question={currentQuestion}
        uiHidden={uiHidden}
        center={<TurnPill room={room} mySessionId={session.id} members={members} />}
      />
      <ConnectionAlerts progress={progress} retry={stt.retry} />
      <Dialog bottom="pb-[5px]" hidden={uiHidden}>
        <QuestionBubble
          interviewer={interviewer}
          question={stt.question ?? (myTurn ? currentQuestion : null)}
        />
        <ChatPanel
          key={panelKey ?? "locked"}
          sessionId={session.id}
          question={myQuestion}
          submissionLocked={!answering}
          inputQuestionSeq={myQuestion?.seq}
          onChatInput={onChatInput}
          onSubmitStart={duckExclaim ?? undefined}
          onAnswered={draft.clear}
          group
          initialText={draft.initialText}
          onTextChange={draft.keep}
        />
      </Dialog>
    </>
  );
}

/** 질문 하나의 작성 중인 글을 두는 sessionStorage 키(BE Redis 키와 같은 모양) */
const draftStorageKey = (sessionId: number, questionId: number) =>
  `group-draft:${sessionId}:${questionId}`;

function readDraft(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/**
 * 작성 중인 답변(API 명세 10.9).
 * - 입력이 0.8초 멈출 때마다(save) 저장하되 최소 5초 간격을 지킨다. 5초 안에 다시 멈추면 5초가 되는 때에 가장 최근 글로 저장한다
 * - 답변 중(ANSWERING)일 때만 보낸다(질문 음성 중 · 마감 뒤는 409 QUESTION_CLOSED). 답변 중이 되면 쓰던 글을 한 번 보낸다(새로고침 복구 · 음성 중 입력)
 * - 창을 벗어날 때(pagehide · 탭 숨김) 바로 보낸다
 * - 같은 글을 sessionStorage에도 두고(keep), 새로고침하면 그 글로 입력칸을 시작한다(initialText). 5.7로 냈으면 지운다(clear)
 */
function useAnswerDraft(sessionId: number, questionId: number | null, answering: boolean) {
  const storageKey = questionId === null ? null : draftStorageKey(sessionId, questionId);
  const [initial, setInitial] = useState(() => ({
    key: storageKey,
    text: storageKey ? readDraft(storageKey) : "",
  }));
  if (initial.key !== storageKey) {
    setInitial({ key: storageKey, text: storageKey ? readDraft(storageKey) : "" });
  }
  const latest = useRef(initial.text);
  const lastSent = useRef<{ text: string; at: number } | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef({ answering, sessionId, questionId });
  useEffect(() => {
    live.current = { answering, sessionId, questionId };
  });
  useEffect(() => {
    latest.current = initial.text;
    lastSent.current = null;
    return () => clearTimeout(pending.current);
  }, [initial]);

  const send = useCallback(() => {
    clearTimeout(pending.current);
    const { answering: open, sessionId: id, questionId: question } = live.current;
    if (!open || question === null || lastSent.current?.text === latest.current) return;
    lastSent.current = { text: latest.current, at: Date.now() };
    void saveAnswerDraft(id, question, latest.current);
  }, []);

  const save = useCallback(
    (text: string) => {
      latest.current = text;
      clearTimeout(pending.current);
      const wait = (lastSent.current?.at ?? 0) + DRAFT_MIN_INTERVAL_MS - Date.now();
      if (wait <= 0) send();
      else pending.current = setTimeout(send, wait);
    },
    [send],
  );

  // 답변 중이 되면 쓰던 글을 한 번 보낸다
  useEffect(() => {
    if (answering && latest.current) send();
  }, [answering, questionId, send]);

  // 창을 벗어날 때 바로 보낸다
  useEffect(() => {
    const leave = () => {
      if (document.visibilityState === "hidden") send();
    };
    window.addEventListener("pagehide", send);
    document.addEventListener("visibilitychange", leave);
    return () => {
      window.removeEventListener("pagehide", send);
      document.removeEventListener("visibilitychange", leave);
    };
  }, [send]);

  const keep = useCallback(
    (text: string) => {
      latest.current = text;
      if (!storageKey) return;
      try {
        sessionStorage.setItem(storageKey, text);
      } catch {
        // 저장할 수 없으면 새로고침 복구만 빠진다
      }
    },
    [storageKey],
  );

  const clear = useCallback(() => {
    clearTimeout(pending.current);
    latest.current = "";
    if (!storageKey) return;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // 지우지 못해도 다음 질문은 다른 키라 섞이지 않는다
    }
  }, [storageKey]);

  return { initialText: initial.text, save, keep, clear };
}
