"use client";

import { Room, RoomEvent, RpcError, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { issueRoomToken } from "@/lib/interview/actions";
import {
  ANSWER_REJECTED_CODES,
  ANSWER_STATE_METHOD,
  ANSWER_SUBMIT_METHOD,
  QUESTION_METHOD,
  CHAT_INPUT_METHOD,
  FRAME_TOPIC,
  chatInputPayload,
  REACTION_METHOD,
  reactionMessageSchema,
  type ReactionSnapshot,
  questionMessageSchema,
  type QuestionMessage,
  answerStateSchema,
  answerSubmitPayload,
  answerSubmitResponseSchema,
  type AnswerStateMessage,
} from "@/lib/interview/room-messages";
import { STT_TOPIC, transcriptSchema } from "@/lib/interview/transcript";
import type { ListeningActivity } from "@/lib/interviewer/reaction";

// 기준: 웹 Swagger 5.14 · RoomResponse · 사용자 승인 마이크 송출/STT 표시 계획.
// SDK: https://docs.livekit.io/transport/data/text-streams/ · publishTrack(MediaStreamTrack)
// · 원격 트랙 재생 RemoteTrack.attach()(https://docs.livekit.io/transport/media/subscribe/).
// · 웹 Swagger 5.4(채팅도 면접방에 들어간다(송출 없이 수신·메시지만)) · 사용자 결정(2026-10-26: 채팅도 5.14로 입장한다)
// · API 명세 면접방 메시지(answer.state 수신 · answer.submit 전송) · RPC(https://docs.livekit.io/transport/data/rpc/)
// · API 명세 녹화(화면은 카메라 영상을 H.264로 송출한다) · AI 명세 7장(candidate-video H.264 → mp4)
// · 사용자 결정(2026-10-27: 카메라 송출이 실패해도 면접은 표시 없이 계속)
export type InterviewRoomStatus =
  "idle" | "connecting" | "listening" | "reconnecting" | "failed" | "sttFailed";

export interface RoomPresentation {
  question: QuestionMessage | null;
  reaction: ReactionSnapshot | null;
  listening: ListeningActivity | null;
}

const INITIAL = {
  status: "idle" as InterviewRoomStatus,
  /** 지금 표시하는 STT 캡처. 에이전트가 답변마다 새로 연다(AI 명세 6.3 streamId) */
  streamId: null as string | null,
  confirmedText: "",
  interimText: "",
};

/**
 * [답변 완료](answer.submit) 결과: 받음 · 에이전트가 받지 않음(이미 제출 중 · 지난 질문 · 한마디도 안 함 · 답변 중이 아님)
 * · 보내지 못함
 */
export type SubmitAnswerResult = "accepted" | "rejected" | "failed";

/** 에이전트가 [답변 완료]를 받았는지. 응답 형식이 틀리면 받지 않은 것으로 본다(다시 보내도 같은 응답이다). */
function accepted(response: string) {
  try {
    const parsed = answerSubmitResponseSchema.safeParse(JSON.parse(response));
    return parsed.success && parsed.data.accepted;
  } catch {
    return false;
  }
}

/**
 * 면접방에 들어간다. 화상은 마이크(stream)를 받은 뒤 들어가 송출하고,
 * 채팅(listenOnly)은 마이크 없이 들어가 면접관 음성만 재생한다.
 * 에이전트가 보내는 답변 상태(answer.state)는 onAnswerState로 넘기고, [답변 완료]는 submitAnswer로 보낸다.
 */
export function useInterviewRoom(
  sessionId: number,
  stream: MediaStream | null,
  {
    listenOnly = false,
    onAnswerState,
    questionSeq,
    onPresentation,
  }: {
    listenOnly?: boolean;
    onAnswerState?: (message: AnswerStateMessage) => void;
    questionSeq?: number;
    onPresentation?: (value: RoomPresentation | null) => void;
  } = {},
) {
  const microphone = listenOnly ? undefined : stream?.getAudioTracks()[0];
  const camera = listenOnly ? undefined : stream?.getVideoTracks()[0];
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(INITIAL);
  const [question, setQuestion] = useState<QuestionMessage | null>(null);
  const [reaction, setReaction] = useState<ReactionSnapshot | null>(null);
  const [listening, setListening] = useState<ListeningActivity | null>(null);
  const closedQuestions = useRef(new Set<number>());
  const pendingSubmissions = useRef(new Map<Room, number>());
  const questionSequence = useRef(questionSeq);
  useEffect(() => {
    questionSequence.current = questionSeq;
  }, [questionSeq]);
  useEffect(() => {
    const active = question && question.seq >= (questionSeq ?? 0) ? question : null;
    const seq = active?.seq ?? questionSeq;
    onPresentation?.({
      question: active,
      reaction: reaction?.message.questionSeq === seq ? reaction : null,
      listening: listening?.questionSeq === seq ? listening : null,
    });
  }, [question, reaction, listening, questionSeq, onPresentation]);
  useEffect(() => () => onPresentation?.(null), [onPresentation]);
  const retry = useCallback(() => {
    setReaction(null);
    setListening(null);
    setAttempt((value) => value + 1);
  }, []);
  const connected = useRef<Room | null>(null);
  // 받은 함수가 바뀌어도 다시 입장하지 않도록 최신 함수만 기억한다.
  const answerState = useRef(onAnswerState);
  useEffect(() => {
    answerState.current = onAnswerState;
  });

  useEffect(() => {
    const track = microphone;
    if (!track && !listenOnly) return;
    const room = new Room({ stopLocalTrackOnUnpublish: false });
    const lifetime = new AbortController();
    let disposed = false;
    let currentStream: string | null = null;
    let latestText = "";
    let reconnecting = false;
    let failed = false;
    let revision = -1;
    let sttStatus: InterviewRoomStatus = "connecting";
    const retiredStreams = new Set<string>();
    let latestQuestion: QuestionMessage | null = null;
    const reactionSequences = new Map<number, number>();
    closedQuestions.current.clear();

    room.registerRpcMethod(REACTION_METHOD, async (data) => {
      if (disposed || !room.remoteParticipants.get(data.callerIdentity)?.isAgent) return "";
      try {
        if (new TextEncoder().encode(data.payload).length > 15 * 1024) return "";
        const parsed = reactionMessageSchema.safeParse(JSON.parse(data.payload));
        if (!parsed.success || parsed.data.sessionId !== sessionId) return "";
        const message = parsed.data;
        const active = Math.max(latestQuestion?.seq ?? 0, questionSequence.current ?? 0);
        if (
          message.questionSeq !== active ||
          latestQuestion?.speech === "started" ||
          closedQuestions.current.has(active) ||
          pendingSubmissions.current.has(room)
        )
          return "";
        if (listenOnly && message.interrupt !== null) return "";
        if (message.seq <= (reactionSequences.get(active) ?? 0)) return "";
        reactionSequences.set(active, message.seq);
        setReaction({ message, receivedAt: performance.now() });
      } catch {
        // 형식이 잘못된 리액션은 면접 진행에 반영하지 않는다.
      }
      return "";
    });

    room.registerRpcMethod(QUESTION_METHOD, async (data) => {
      if (disposed || !room.remoteParticipants.get(data.callerIdentity)?.isAgent) return "";
      try {
        const parsed = questionMessageSchema.safeParse(JSON.parse(data.payload));
        if (!parsed.success || parsed.data.sessionId !== sessionId) return "";
        const message = parsed.data;
        if (
          latestQuestion &&
          (message.seq < latestQuestion.seq ||
            (message.seq === latestQuestion.seq && latestQuestion.speech !== "started"))
        )
          return "";
        latestQuestion = message;
        if (message.speech === "started") {
          setReaction(null);
          setListening(null);
          if (currentStream) retiredStreams.add(currentStream);
        }
        setQuestion(message);
      } catch {
        // 잘못된 본문은 화면에 반영하지 않는다.
      }
      return "";
    });

    function fail() {
      if (!disposed) {
        failed = true;
        setReaction(null);
        setListening(null);
        setState((previous) => ({ ...previous, status: "failed" }));
      }
    }

    room.on(RoomEvent.Reconnecting, () => {
      if (!disposed) {
        reconnecting = true;
        setListening(null);
        setState((previous) => ({ ...previous, status: "reconnecting" }));
      }
    });
    room.on(RoomEvent.Reconnected, () => {
      reconnecting = false;
      if (!disposed) setState((previous) => ({ ...previous, status: sttStatus }));
    });
    room.on(RoomEvent.Disconnected, fail);
    track?.addEventListener("ended", fail);

    // 면접관(에이전트)의 질문 음성을 재생한다(AI 명세 6.2 질문).
    const voices = new Set<HTMLMediaElement>();
    room.on(RoomEvent.TrackSubscribed, (remote, _publication, participant) => {
      if (remote.kind !== Track.Kind.Audio || !participant.isAgent) return;
      const element = remote.attach();
      element.hidden = true;
      document.body.append(element);
      voices.add(element);
    });
    room.on(RoomEvent.TrackUnsubscribed, (remote) => {
      for (const element of remote.detach()) {
        element.remove();
        voices.delete(element);
      }
    });

    // 마이크 송출 전에 수신을 등록해 첫 인식 결과도 받을 수 있게 한다.
    room.registerTextStreamHandler(STT_TOPIC, (reader, sender) => {
      if (!room.remoteParticipants.get(sender.identity)?.isAgent) return;
      void (async () => {
        try {
          const text = await reader.readAll({
            signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
          });
          if (disposed || !room.remoteParticipants.get(sender.identity)?.isAgent) return;
          const parsed = transcriptSchema.safeParse(JSON.parse(text));
          if (!parsed.success) return;
          const snapshot = parsed.data;
          if (retiredStreams.has(snapshot.streamId)) return;
          if (currentStream !== snapshot.streamId) {
            if (currentStream)
              closedQuestions.current.delete(
                Math.max(latestQuestion?.seq ?? 0, questionSequence.current ?? 0),
              );
            if (currentStream) retiredStreams.add(currentStream);
            currentStream = snapshot.streamId;
            latestText = "";
            setListening(null);
            revision = -1;
          }
          if (snapshot.revision <= revision) return;
          revision = snapshot.revision;
          sttStatus = snapshot.state === "failed" ? "sttFailed" : "listening";
          const caption = (snapshot.confirmedText + snapshot.interimText).trim();
          const active = Math.max(latestQuestion?.seq ?? 0, questionSequence.current ?? 0);
          if (snapshot.state === "failed" || !caption) setListening(null);
          else if (
            !listenOnly &&
            !reconnecting &&
            !failed &&
            !pendingSubmissions.current.has(room) &&
            caption !== latestText &&
            active > 0 &&
            latestQuestion?.speech !== "started" &&
            !closedQuestions.current.has(active)
          ) {
            setListening({
              questionSeq: active,
              streamId: snapshot.streamId,
              speechAt: performance.now(),
            });
          }
          latestText = caption;
          setState({
            status: sttStatus,
            streamId: snapshot.streamId,
            confirmedText: snapshot.confirmedText,
            interimText: snapshot.interimText,
          });
        } catch {
          // 잘못된 메시지와 종료된 스트림은 버린다. 답변 원문은 로그에 남기지 않는다.
        }
      })();
    });

    // 에이전트의 답변 상태(자동 제출 · 제출됨 · 제출 실패 등). 화면이 할 일은 받은 쪽이 정한다.
    room.registerRpcMethod(ANSWER_STATE_METHOD, async (data) => {
      if (!room.remoteParticipants.get(data.callerIdentity)?.isAgent) return "";
      try {
        const parsed = answerStateSchema.safeParse(JSON.parse(data.payload));
        if (!disposed && parsed.success && parsed.data.sessionId === sessionId) {
          if (parsed.data.seq === Math.max(latestQuestion?.seq ?? 0, questionSequence.current ?? 0))
            setListening(null);
          if (
            parsed.data.seq === Math.max(latestQuestion?.seq ?? 0, questionSequence.current ?? 0) &&
            ["autoSubmitted", "submitted", "submitFailed"].includes(parsed.data.state)
          ) {
            closedQuestions.current.add(parsed.data.seq);
            setReaction(null);
            setListening(null);
          }
          answerState.current?.(parsed.data);
        }
      } catch {
        // 잘못된 메시지는 버린다.
      }
      return "";
    });

    const connect = async () => {
      setState({ ...INITIAL, status: "connecting" });
      try {
        const access = await issueRoomToken(sessionId);
        if (disposed) return;
        setReaction(null);
        setListening(null);
        setQuestion(null);
        if (!access.ok || track?.readyState === "ended") {
          fail();
          return;
        }
        await room.connect(access.url, access.token);
        if (disposed) {
          await room.disconnect(false);
          return;
        }
        connected.current = room;
        // 채팅은 송출하지 않는다(웹 Swagger 5.4). 들어가면 면접관 음성을 듣는 중이다(STT 메시지는 오지 않는다).
        if (!track) {
          sttStatus = "listening";
          setState((previous) => ({ ...previous, status: sttStatus }));
          return;
        }
        await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
        if (disposed) {
          await room.localParticipant.unpublishTrack(track, false);
          await room.disconnect(false);
          return;
        }
        if (camera) await publishCamera(room, camera);
      } catch {
        fail();
        await room.disconnect(false);
      }
    };
    void connect();

    return () => {
      disposed = true;
      lifetime.abort();
      if (connected.current === room) connected.current = null;
      room.unregisterRpcMethod(ANSWER_STATE_METHOD);
      room.unregisterRpcMethod(QUESTION_METHOD);
      room.unregisterRpcMethod(REACTION_METHOD);
      track?.removeEventListener("ended", fail);
      room.unregisterTextStreamHandler(STT_TOPIC);
      room.removeAllListeners();
      for (const element of voices) element.remove();
      // 마이크 소유자는 기존 useInterviewMedia다. SDK가 원본 트랙을 중지하지 않게 한다.
      void room.disconnect(false);
    };
  }, [sessionId, microphone, camera, listenOnly, attempt]);

  // [답변 완료]를 에이전트에 보낸다(answer.submit). 방에 들어가 있지 않거나 에이전트가 없으면 보내지 못한다.
  const submitAnswer = useCallback(
    async (seq: number, content: string | null = null): Promise<SubmitAnswerResult> => {
      const room = connected.current;
      const agent = room && [...room.remoteParticipants.values()].find((p) => p.isAgent);
      setListening(null);
      setReaction(null);
      if (!room || !agent) return "failed";
      pendingSubmissions.current.set(room, (pendingSubmissions.current.get(room) ?? 0) + 1);
      try {
        const response = await room.localParticipant.performRpc({
          destinationIdentity: agent.identity,
          method: ANSWER_SUBMIT_METHOD,
          payload: answerSubmitPayload(sessionId, seq, content),
        });
        if (connected.current !== room) return "failed";
        if (!accepted(response)) return "rejected";
        closedQuestions.current.add(seq);
        setReaction(null);
        setListening(null);
        return "accepted";
      } catch (error) {
        const rejected =
          error instanceof RpcError &&
          (ANSWER_REJECTED_CODES as readonly number[]).includes(error.code);
        return rejected ? "rejected" : "failed";
      } finally {
        const pending = (pendingSubmissions.current.get(room) ?? 1) - 1;
        if (pending === 0) pendingSubmissions.current.delete(room);
        else pendingSubmissions.current.set(room, pending);
      }
    },
    [sessionId],
  );

  const sendChatInput = useCallback(
    async (questionSeq: number, seq: number, text: string, pauseMs: number) => {
      const room = connected.current;
      const agent = room && [...room.remoteParticipants.values()].find((p) => p.isAgent);
      if (!listenOnly || !room || !agent) return;
      try {
        await room.localParticipant.performRpc({
          destinationIdentity: agent.identity,
          method: CHAT_INPUT_METHOD,
          payload: chatInputPayload(sessionId, questionSeq, seq, text, pauseMs),
        });
      } catch {
        // 리액션 입력 전송에 실패해도 답변 제출은 계속 진행한다.
      }
    },
    [sessionId, listenOnly],
  );

  // 인상 판단 사진을 에이전트에 보낸다(AI 명세 6.3 interview.frame). 응답을 기다리지 않고, 실패해도 면접은 이어 간다.
  // ageMs는 찍은 뒤 보낼 때까지 걸린 시간이다. 에이전트가 받은 시각에서 빼 찍은 시각을 구한다(브라우저 시계는 쓰지 않는다)
  const sendFrame = useCallback(
    async (jpeg: Blob, capturedAt: number) => {
      const room = connected.current;
      const agent = room && [...room.remoteParticipants.values()].find((p) => p.isAgent);
      if (listenOnly || !room || !agent) return;
      try {
        const bytes = new Uint8Array(await jpeg.arrayBuffer());
        await room.localParticipant.sendBytes(bytes, {
          topic: FRAME_TOPIC,
          destinationIdentities: [agent.identity],
          attributes: { ageMs: String(Math.max(0, Math.round(performance.now() - capturedAt))) },
        });
      } catch {
        // 사진 전송 실패는 면접 진행에 영향을 주지 않는다.
      }
    },
    [listenOnly],
  );

  return { ...state, question, reaction, retry, submitAnswer, sendChatInput, sendFrame };
}

/**
 * 녹화할 카메라 영상을 올린다. 서버가 올라온 트랙을 녹화하고, 합치기는 영상을 다시 인코딩하지 않으므로 H.264로 보낸다
 * (API 명세 녹화 · AI 명세 7장). 실시간으로 보는 사람이 없어 화질 단계(simulcast)는 보내지 않는다.
 * 실패해도 면접은 표시 없이 이어 간다. 그 면접은 다시보기 영상이 없다(사용자 결정 2026-10-27).
 */
async function publishCamera(room: Room, camera: MediaStreamTrack) {
  try {
    await room.localParticipant.publishTrack(camera, {
      source: Track.Source.Camera,
      videoCodec: "h264",
      simulcast: false,
    });
  } catch {
    // 카메라 송출 실패는 면접 진행에 영향을 주지 않는다.
  }
}
