// 기준: 웹 Swagger 5.14 면접방 입장 · 5.4(채팅도 면접방에 들어간다(송출 없이 수신 · 메시지만))
// · API 명세 면접방 메시지(answer.state 수신 · answer.submit 전송) · AI 명세 6.3(question · reaction · attitude · interview.frame · RPC 오류 2001 · 2002)
// · 사용자 결정(2026-11-12 인상 점수는 최근 30초 추이)
// · 사용자 승인 STT 표시 계약 · 사용자 결정(2026-10-27 카메라 송출 실패해도 계속 · 2026-11-09 마이크를 다시 받으면 송출 트랙만 바꿈)
// · API 명세 10.11 그룹 면접방(방 정보 room metadata · 지금 답변자의 sessionId로 오는 question · reaction)
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANSWER_REJECTED_CODES,
  ANSWER_STATE_METHOD,
  ATTITUDE_METHOD,
  QUESTION_METHOD,
  REACTION_METHOD,
  type AnswerStateMessage,
} from "@/lib/interview/room-messages";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";

import { useInterviewRoom, type SubmitAnswerResult } from "./use-interview-room";

// 경계 mock: LiveKit SDK(방 · RPC · 텍스트 스트림 · 송출)와 서버 액션(5.14 입장 토큰).
// 가짜 방은 등록한 메시지 처리기를 보관하고, 테스트가 면접관(agent)이 보낸 것처럼 직접 부른다.
const sdk = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  type RpcHandler = (data: { callerIdentity: string; payload: string }) => Promise<string>;
  type TextHandler = (
    reader: { readAll: () => Promise<string> },
    sender: { identity: string },
  ) => void;
  interface MicrophonePublication {
    mediaStreamTrack: { readyState: string };
    isMuted: boolean;
    isUpstreamPaused: boolean;
    replaceTrack: ReturnType<typeof vi.fn>;
    unmute: ReturnType<typeof vi.fn>;
    pauseUpstream: ReturnType<typeof vi.fn>;
    resumeUpstream: ReturnType<typeof vi.fn>;
    listeners: Map<string, (track: unknown) => void>;
    on: (event: string, handler: (track: unknown) => void) => void;
    off: (event: string) => void;
  }

  function publication(track: { readyState: string }): MicrophonePublication {
    const published: MicrophonePublication = {
      mediaStreamTrack: track,
      isMuted: false,
      isUpstreamPaused: false,
      replaceTrack: vi.fn(async (next: { readyState: string }) => {
        published.mediaStreamTrack = next;
      }),
      unmute: vi.fn(async () => {
        published.isMuted = false;
      }),
      pauseUpstream: vi.fn(async () => {
        published.isUpstreamPaused = true;
      }),
      resumeUpstream: vi.fn(async () => {
        published.isUpstreamPaused = false;
      }),
      listeners: new Map(),
      on: (event, handler) => published.listeners.set(event, handler),
      off: (event) => published.listeners.delete(event),
    };
    return published;
  }

  class FakeRoom {
    static instances: FakeRoom[] = [];
    /** 방을 만든 직후 테스트가 고칠 것(입장 · 송출을 기다리게 하기 등) */
    static prepare: ((room: FakeRoom) => void) | null = null;
    connectGate: Promise<void> | null = null;
    publishGate: Promise<void> | null = null;
    microphone: MicrophonePublication | undefined = undefined;
    /** 그룹 면접방 정보(LiveKit room metadata) */
    metadata: string | undefined = undefined;
    handlers = new Map<string, Handler>();
    rpcHandlers = new Map<string, RpcHandler>();
    textHandler: TextHandler | undefined = undefined;
    remoteParticipants = new Map([
      ["agent", { identity: "agent", isAgent: true }],
      ["other", { identity: "other", isAgent: false }],
    ]);
    localParticipant = {
      publishTrack: vi.fn(async (track: { readyState: string }, options: { source: string }) => {
        if (this.publishGate) await this.publishGate;
        if (options.source === "microphone") this.microphone = publication(track);
      }),
      getTrackPublication: vi.fn((source: string) =>
        source === "microphone" && this.microphone ? { track: this.microphone } : undefined,
      ),
      unpublishTrack: vi.fn(async () => {}),
      performRpc: vi.fn<(params: { destinationIdentity: string }) => Promise<string>>(async () =>
        JSON.stringify({ accepted: true }),
      ),
      sendBytes: vi.fn<(bytes: Uint8Array, options: unknown) => Promise<void>>(async () => {}),
    };
    connect = vi.fn<(url: string, token: string) => Promise<void>>(async () => {
      if (this.connectGate) await this.connectGate;
    });
    disconnect = vi.fn<(stopTracks?: boolean) => Promise<void>>(async () => {});
    removeAllListeners = vi.fn();
    registerRpcMethod = vi.fn((method: string, handler: RpcHandler) => {
      this.rpcHandlers.set(method, handler);
    });
    unregisterRpcMethod = vi.fn((method: string) => {
      this.rpcHandlers.delete(method);
    });
    registerTextStreamHandler = vi.fn((_topic: string, handler: TextHandler) => {
      this.textHandler = handler;
    });
    unregisterTextStreamHandler = vi.fn(() => {
      this.textHandler = undefined;
    });
    constructor() {
      FakeRoom.instances.push(this);
      FakeRoom.prepare?.(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, handler);
      return this;
    }
  }

  class RpcError extends Error {
    constructor(
      readonly code: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { FakeRoom, RpcError, issueRoomToken: vi.fn() };
});

vi.mock("livekit-client", () => ({
  Room: sdk.FakeRoom,
  RpcError: sdk.RpcError,
  RoomEvent: {
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
    RoomMetadataChanged: "roomMetadataChanged",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
  },
  Track: {
    Source: { Microphone: "microphone", Camera: "camera" },
    Kind: { Audio: "audio", Video: "video" },
  },
  TrackEvent: { Muted: "muted" },
}));
vi.mock("@/lib/interview/actions", () => ({ issueRoomToken: sdk.issueRoomToken }));

type FakeRoom = InstanceType<typeof sdk.FakeRoom>;

// 예시 데이터: Swagger 5.14 200 예시(입장 정보)
const ACCESS = {
  ok: true,
  url: "wss://room.test",
  token: "room-token",
  expiresAt: "2026-10-23T15:00:00+09:00",
};

/** 화면이 받은 마이크(와 카메라). 트랙은 readyState만 본다 */
function media({ camera = false, microphone = true } = {}) {
  const tracks = { microphone: { readyState: "live" }, camera: { readyState: "live" } };
  const stream = {
    getAudioTracks: () => (microphone ? [tracks.microphone] : []),
    getVideoTracks: () => (camera ? [tracks.camera] : []),
  } as unknown as MediaStream;
  return { stream, ...tracks };
}

interface Props {
  stream: MediaStream | null;
  questionSeq: number | undefined;
  onAnswerState: ((message: AnswerStateMessage) => void) | undefined;
}

/** 면접방 훅을 그리고 입장 · 송출이 끝날 때까지 기다린다. 기본은 화상 · 화면이 아는 질문 3번 */
async function join(
  options: {
    listenOnly?: boolean;
    group?: boolean;
    stream?: MediaStream | null;
    questionSeq?: number;
    onAnswerState?: (message: AnswerStateMessage) => void;
  } = {},
) {
  const devices = media();
  const listenOnly = options.listenOnly ?? false;
  const onPresentation = vi.fn();
  let props: Props = {
    stream: "stream" in options ? (options.stream ?? null) : listenOnly ? null : devices.stream,
    questionSeq: "questionSeq" in options ? options.questionSeq : 3,
    onAnswerState: options.onAnswerState,
  };
  const hook = renderHook(
    (current: Props) =>
      useInterviewRoom(55, current.stream, {
        listenOnly,
        group: options.group,
        onAnswerState: current.onAnswerState,
        questionSeq: current.questionSeq,
        onPresentation,
      }),
    { initialProps: props },
  );
  await flushPromises();
  const update = async (patch: Partial<Props>) => {
    props = { ...props, ...patch };
    hook.rerender(props);
    await flushPromises();
  };
  return {
    ...hook,
    update,
    room: sdk.FakeRoom.instances[0] as FakeRoom,
    microphone: devices.microphone,
    onPresentation,
    presented: () => onPresentation.mock.lastCall?.[0],
  };
}

// 예시 데이터: AI 명세 6.3 interview.question · interview.reaction · interview.answerState 예시, STT 스냅샷 계약 예시
function question(seq: number, speech: "started" | "ended" | "failed", sessionId = 55) {
  return {
    type: "question",
    sessionId,
    seq,
    content: "트랜잭션 격리 수준을 설명해 주세요.",
    speech,
    alignment: null,
  };
}
function reaction(questionSeq: number, seq: number, overrides: Record<string, unknown> = {}) {
  return {
    type: "reaction",
    sessionId: 55,
    questionSeq,
    seq,
    reaction: {
      type: "expression",
      expression: "smile",
      gesture: null,
      intensity: 0.6,
      durationMs: 2400,
    },
    attitude: { interest: 0.7, trust: 0.6 },
    interrupt: null,
    ...overrides,
  };
}
function attitude(score: unknown, overrides: Record<string, unknown> = {}) {
  return { type: "attitude", sessionId: 55, score, ...overrides };
}
function answerState(seq: number, state: AnswerStateMessage["state"], sessionId = 55) {
  return { type: "answer.state", sessionId, seq, state };
}
function snapshot(revision: number, overrides: Record<string, unknown> = {}) {
  return {
    streamId: "capture-1",
    revision,
    confirmedText: "안녕하세요",
    interimText: " 저는",
    state: "listening",
    ...overrides,
  };
}

/** 면접관(또는 caller)이 RPC 메시지를 보낸다 */
function rpc(room: FakeRoom, method: string, payload: unknown, caller = "agent") {
  const handler = room.rpcHandlers.get(method);
  return act(async () => {
    await handler?.({
      callerIdentity: caller,
      payload: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  });
}
/** 면접관(또는 sender)이 STT 스냅샷을 텍스트 스트림으로 보낸다 */
async function stt(room: FakeRoom, payload: unknown, sender = "agent") {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  room.textHandler?.({ readAll: async () => text }, { identity: sender });
  await flushPromises();
}
/** SDK가 방 이벤트(재접속 · 끊김 · 트랙 구독)를 알린다 */
function emit(room: FakeRoom, event: string, ...args: unknown[]) {
  act(() => room.handlers.get(event)?.(...args));
}

beforeEach(() => {
  sdk.FakeRoom.instances = [];
  sdk.FakeRoom.prepare = null;
  sdk.issueRoomToken.mockResolvedValue(ACCESS);
});

describe("useInterviewRoom · 면접방 연결", () => {
  describe("입장 · 송출", () => {
    describe("사용자 조작", () => {
      it("다시 연결하면 이전 질문 · 리액션 · 끄덕임 정보를 지우고 새 입장 토큰으로 새 방에 들어간다", async () => {
        const { result, room, presented } = await join();
        await rpc(room, QUESTION_METHOD, question(3, "ended"));
        await rpc(room, REACTION_METHOD, reaction(3, 1));
        await stt(room, snapshot(0));

        act(() => result.current.retry());
        await flushPromises();

        expect(sdk.issueRoomToken).toHaveBeenCalledTimes(2);
        expect(sdk.FakeRoom.instances).toHaveLength(2);
        expect(sdk.FakeRoom.instances[1].connect).toHaveBeenCalledTimes(1);
        expect(result.current.question).toBeNull();
        expect(result.current.reaction).toBeNull();
        expect(presented()).toEqual({ question: null, reaction: null, listening: null });
      });
    });

    describe("정상 처리", () => {
      it("입장 토큰을 받으면 방에 들어가 마이크를 송출한다", async () => {
        const { room, microphone } = await join();

        expect(room.connect).toHaveBeenCalledTimes(1);
        expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
        expect(room.localParticipant.publishTrack.mock.calls[0][0]).toBe(microphone);
      });

      it("카메라가 있으면 마이크를 올린 뒤 카메라를 올린다", async () => {
        const devices = media({ camera: true });
        const { room } = await join({ stream: devices.stream });

        const published = room.localParticipant.publishTrack.mock.calls.map(([track]) => track);
        expect(published).toHaveLength(2);
        expect(published[0]).toBe(devices.microphone);
        expect(published[1]).toBe(devices.camera);
      });

      it("채팅이면 마이크 없이 들어가 송출하지 않고 listening이 된다", async () => {
        const { result, room } = await join({ listenOnly: true });

        expect(room.connect).toHaveBeenCalledTimes(1);
        expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
        expect(result.current.status).toBe("listening");
      });
    });

    describe("상태 변화", () => {
      it("입장을 시작하면 connecting이 된다", async () => {
        const token = deferred<typeof ACCESS>();
        sdk.issueRoomToken.mockReturnValue(token.promise);
        const { result } = await join();

        expect(result.current.status).toBe("connecting");
        await act(async () => token.resolve(ACCESS));
      });

      it("화상은 송출을 마쳐도 첫 인식 결과가 오기 전까지 connecting이다", async () => {
        const { result, room } = await join();

        expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("connecting");
      });

      it("SDK가 재접속을 시작하면 reconnecting이 되고 끄덕임 정보를 지운다", async () => {
        const { result, room, presented } = await join();
        await stt(room, snapshot(0));
        expect(presented().listening).not.toBeNull();

        emit(room, "reconnecting");

        expect(result.current.status).toBe("reconnecting");
        expect(presented().listening).toBeNull();
      });

      it("재접속에 성공하면 직전 인식 상태로 돌아가고 자막 글은 그대로다", async () => {
        const { result, room } = await join();
        await stt(room, snapshot(0, { state: "failed" }));
        emit(room, "reconnecting");

        emit(room, "reconnected");

        expect(result.current.status).toBe("sttFailed");
        expect(result.current.confirmedText).toBe("안녕하세요");
        expect(result.current.interimText).toBe(" 저는");
      });

      it("연결이 끊기면 failed가 되고 리액션 · 끄덕임 정보를 지운다", async () => {
        const { result, room, presented } = await join();
        await rpc(room, REACTION_METHOD, reaction(3, 1));
        await stt(room, snapshot(0));

        emit(room, "disconnected");

        expect(result.current.status).toBe("failed");
        expect(result.current.reaction).toBeNull();
        expect(presented().listening).toBeNull();
      });
    });

    describe("입력 검증", () => {
      it("화상인데 마이크가 없으면 입장 토큰을 요청하지 않고 방을 만들지 않는다", async () => {
        await join({ stream: media({ microphone: false }).stream });

        expect(sdk.issueRoomToken).not.toHaveBeenCalled();
        expect(sdk.FakeRoom.instances).toHaveLength(0);
      });
    });

    describe("오류 처리", () => {
      it.each([
        {
          label: "토큰 발급 실패",
          arrange: () => sdk.issueRoomToken.mockResolvedValue({ ok: false }),
        },
        {
          label: "그사이 마이크 끝남",
          arrange: (microphone: { readyState: string }) =>
            sdk.issueRoomToken.mockImplementation(async () => {
              microphone.readyState = "ended";
              return ACCESS;
            }),
        },
      ])("'$label'이면 연결하지 않고 failed가 된다", async ({ arrange }) => {
        const devices = media();
        arrange(devices.microphone);

        const { result, room } = await join({ stream: devices.stream });

        expect(room.connect).not.toHaveBeenCalled();
        expect(result.current.status).toBe("failed");
      });

      it.each([
        {
          label: "방 연결 실패",
          prepare: (room: FakeRoom) => room.connect.mockRejectedValue(new Error("connect failed")),
        },
        {
          label: "마이크 송출 실패",
          prepare: (room: FakeRoom) =>
            room.localParticipant.publishTrack.mockRejectedValue(new Error("publish failed")),
        },
      ])("'$label'면 failed가 되고 방을 나간다", async ({ prepare }) => {
        sdk.FakeRoom.prepare = prepare;

        const { result, room } = await join();

        expect(result.current.status).toBe("failed");
        expect(room.disconnect).toHaveBeenCalledWith(false);
      });

      it("카메라 송출이 실패해도 failed가 되지 않는다", async () => {
        sdk.FakeRoom.prepare = (room) => {
          const publish = room.localParticipant.publishTrack.getMockImplementation()!;
          room.localParticipant.publishTrack.mockImplementation(async (track, options) => {
            if (options.source === "camera") throw new Error("camera failed");
            await publish(track, options);
          });
        };

        const { result, room } = await join({ stream: media({ camera: true }).stream });

        expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
        expect(result.current.status).toBe("connecting");
        expect(room.disconnect).not.toHaveBeenCalled();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("입장 토큰을 기다리는 중 화면을 떠나면 늦게 받은 토큰으로 연결하지 않는다", async () => {
        const token = deferred<typeof ACCESS>();
        sdk.issueRoomToken.mockReturnValue(token.promise);
        const { room, unmount } = await join();

        unmount();
        await act(async () => token.resolve(ACCESS));

        expect(room.connect).not.toHaveBeenCalled();
      });

      it("방 연결을 기다리는 중 화면을 떠나면 연결된 뒤 바로 나간다", async () => {
        const connected = deferred();
        sdk.FakeRoom.prepare = (room) => {
          room.connectGate = connected.promise;
        };
        const { room, unmount } = await join();

        unmount();
        await act(async () => connected.resolve());

        expect(room.disconnect).toHaveBeenCalledTimes(2);
        expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
      });

      it("마이크 송출을 기다리는 중 화면을 떠나면 송출을 거두고 나간다", async () => {
        const published = deferred();
        sdk.FakeRoom.prepare = (room) => {
          room.publishGate = published.promise;
        };
        const { room, microphone, unmount } = await join();

        unmount();
        await act(async () => published.resolve());

        expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(microphone, false);
        expect(room.disconnect).toHaveBeenCalledTimes(2);
      });

      it("다시 연결한 뒤 이전 방의 송출이 실패해도 새 연결은 failed가 되지 않는다", async () => {
        // 송출하는 사이 연결이 끊겨(잠시 멈춤 카드) 다시 연결했고, 이전 방의 송출은 그 뒤에 실패한다
        const published = deferred();
        sdk.FakeRoom.prepare = (room) => {
          room.publishGate = published.promise;
          sdk.FakeRoom.prepare = null;
        };
        const { result, room } = await join();
        emit(room, "disconnected");

        act(() => result.current.retry());
        await flushPromises();
        await act(async () => published.reject(new Error("publish failed")));

        expect(sdk.FakeRoom.instances).toHaveLength(2);
        expect(result.current.status).toBe("connecting");
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 메시지 수신을 모두 풀고 원본 마이크를 멈추지 않는 방식으로 방을 나간다", async () => {
        const { room, unmount } = await join();

        unmount();

        expect(room.rpcHandlers.size).toBe(0);
        expect(room.textHandler).toBeUndefined();
        expect(room.removeAllListeners).toHaveBeenCalledTimes(1);
        expect(room.disconnect).toHaveBeenCalledWith(false);
      });
    });
  });

  describe("마이크 교체", () => {
    describe("상태 변화", () => {
      it("송출 중 마이크를 다시 받으면 방에 다시 들어가지 않고 보내는 트랙만 새 마이크로 바꾼다", async () => {
        const { room, update } = await join();
        const next = media();

        await update({ stream: next.stream });

        expect(sdk.FakeRoom.instances).toHaveLength(1);
        expect(sdk.issueRoomToken).toHaveBeenCalledTimes(1);
        expect(room.microphone?.mediaStreamTrack).toBe(next.microphone);
      });

      it("앞 마이크가 끝나 송출이 음소거돼 있으면 새 마이크로 바꾼 뒤 음소거를 푼다", async () => {
        const { room, update } = await join();
        room.microphone!.isMuted = true;

        await update({ stream: media().stream });

        expect(room.microphone?.unmute).toHaveBeenCalledTimes(1);
        expect(room.microphone?.isMuted).toBe(false);
      });

      it("송출이 멈춰 있으면 새 마이크로 바꾼 뒤 다시 보낸다", async () => {
        const { room, update } = await join();
        room.microphone!.isUpstreamPaused = true;

        await update({ stream: media().stream });

        expect(room.microphone?.resumeUpstream).toHaveBeenCalledTimes(1);
        expect(room.microphone?.isUpstreamPaused).toBe(false);
      });
    });

    describe("경계값", () => {
      it("송출 중인 트랙과 같은 마이크면 바꾸지 않는다", async () => {
        const { room, update } = await join();
        const next = media();
        // SDK가 이미 새 마이크를 보내고 있다
        room.microphone!.mediaStreamTrack = next.microphone;

        await update({ stream: next.stream });

        expect(room.microphone?.replaceTrack).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it("새 마이크로 바꾸지 못해도 오류를 던지지 않는다", async () => {
        // 처리되지 않은 거부가 남으면 Vitest가 실행 실패로 본다
        const { result, room, update } = await join();
        room.microphone!.replaceTrack.mockRejectedValue(new Error("replace failed"));

        await update({ stream: media().stream });

        expect(room.microphone?.replaceTrack).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe("connecting");
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("송출을 시작하는 사이 마이크를 다시 받았으면 송출을 마친 뒤 새 마이크로 바꾼다", async () => {
        const published = deferred();
        sdk.FakeRoom.prepare = (room) => {
          room.publishGate = published.promise;
        };
        const { room, update } = await join();
        const next = media();
        await update({ stream: next.stream });

        await act(async () => published.resolve());
        await flushPromises();

        expect(room.microphone?.mediaStreamTrack).toBe(next.microphone);
      });

      it("송출 중 음소거가 걸려도 지금 마이크가 살아 있으면 다시 푼다", async () => {
        const { room } = await join();
        const published = room.microphone!;
        published.isMuted = true;

        await act(async () => published.listeners.get("muted")?.(published));

        expect(published.unmute).toHaveBeenCalledTimes(1);
      });

      it.each([
        {
          label: "마이크가 끝났으면",
          arrange: (_unmount: () => void, published: NonNullable<FakeRoom["microphone"]>) => {
            published.mediaStreamTrack.readyState = "ended";
          },
        },
        {
          label: "화면을 떠났으면",
          arrange: (unmount: () => void) => unmount(),
        },
      ])("'$label' 늦게 걸린 음소거를 풀지 않는다", async ({ arrange }) => {
        const { room, unmount } = await join();
        const published = room.microphone!;
        const onMuted = published.listeners.get("muted");
        arrange(unmount, published);

        await act(async () => onMuted?.(published));

        expect(published.unmute).not.toHaveBeenCalled();
      });
    });
  });

  describe("송출 잠시 멈춤", () => {
    describe("사용자 조작", () => {
      it("마이크 확인 녹음을 시작하면 송출만 멈추고 끝나면 다시 보낸다", async () => {
        const { result, room } = await join();
        const published = room.microphone!;

        await act(async () => result.current.pauseMicrophone(true));
        expect(published.isUpstreamPaused).toBe(true);
        await act(async () => result.current.pauseMicrophone(false));

        expect(published.isUpstreamPaused).toBe(false);
        expect(room.connect).toHaveBeenCalledTimes(1);
      });
    });

    describe("오류 처리", () => {
      it("송출을 멈추지 못해도 오류를 던지지 않는다", async () => {
        const { result, room } = await join();
        room.microphone!.pauseUpstream.mockRejectedValue(new Error("pause failed"));

        await expect(result.current.pauseMicrophone(true)).resolves.toBeUndefined();
      });
    });
  });

  describe("면접관 음성", () => {
    function remoteTrack(kind: "audio" | "video") {
      const element = document.createElement("audio");
      return { element, track: { kind, attach: () => element, detach: () => [element] } };
    }
    const AGENT = { identity: "agent", isAgent: true };

    describe("정상 처리", () => {
      it("면접관 음성 트랙을 받으면 숨긴 재생 요소를 붙인다", async () => {
        const { room } = await join();
        const voice = remoteTrack("audio");

        emit(room, "trackSubscribed", voice.track, {}, AGENT);

        expect(document.body.contains(voice.element)).toBe(true);
        expect(voice.element.hidden).toBe(true);
      });
    });

    describe("입력 검증", () => {
      it.each([
        {
          label: "다른 참가자의 음성",
          kind: "audio",
          participant: { identity: "other", isAgent: false },
        },
        { label: "면접관의 영상", kind: "video", participant: AGENT },
      ] as const)("'$label'이면 재생 요소를 붙이지 않는다", async ({ kind, participant }) => {
        const { room } = await join();
        const remote = remoteTrack(kind);

        emit(room, "trackSubscribed", remote.track, {}, participant);

        expect(document.body.contains(remote.element)).toBe(false);
      });
    });

    describe("정리", () => {
      it("구독이 끝나면 그 재생 요소를 뗀다", async () => {
        const { room } = await join();
        const voice = remoteTrack("audio");
        emit(room, "trackSubscribed", voice.track, {}, AGENT);

        emit(room, "trackUnsubscribed", voice.track);

        expect(document.body.contains(voice.element)).toBe(false);
      });

      it("화면을 떠나면 남은 재생 요소를 모두 뗀다", async () => {
        const { room, unmount } = await join();
        const voice = remoteTrack("audio");
        emit(room, "trackSubscribed", voice.track, {}, AGENT);

        unmount();

        expect(document.body.contains(voice.element)).toBe(false);
      });
    });
  });

  describe("답변 자막", () => {
    describe("정상 처리", () => {
      it("면접관의 인식 스냅샷을 받으면 확정 · 중간 글과 캡처 id를 보이고 listening이 된다", async () => {
        const { result, room } = await join();

        await stt(room, snapshot(0));

        expect(result.current).toMatchObject({
          status: "listening",
          streamId: "capture-1",
          confirmedText: "안녕하세요",
          interimText: " 저는",
        });
      });
    });

    describe("상태 변화", () => {
      it("실패 스냅샷이면 sttFailed가 되고 그 스냅샷의 글을 보인다", async () => {
        const { result, room } = await join();

        await stt(
          room,
          snapshot(0, { state: "failed", confirmedText: "여기까지", interimText: "" }),
        );

        expect(result.current).toMatchObject({
          status: "sttFailed",
          confirmedText: "여기까지",
          interimText: "",
        });
      });

      it("새 캡처가 열리면 차례(revision)를 처음부터 센다", async () => {
        const { result, room } = await join();
        await stt(room, snapshot(5));

        await stt(room, snapshot(0, { streamId: "capture-2", confirmedText: "다음 답변" }));

        expect(result.current).toMatchObject({ streamId: "capture-2", confirmedText: "다음 답변" });
      });
    });

    describe("입력 검증", () => {
      it("면접관이 아닌 참가자가 보낸 스냅샷은 보이지 않는다", async () => {
        const { result, room } = await join();

        await stt(room, snapshot(0), "other");

        expect(result.current).toMatchObject({
          status: "connecting",
          streamId: null,
          confirmedText: "",
        });
      });

      it("읽는 사이 보낸 면접관이 방을 나가면 보이지 않는다", async () => {
        const { result, room } = await join();
        const text = deferred<string>();
        room.textHandler?.({ readAll: () => text.promise }, { identity: "agent" });

        room.remoteParticipants.delete("agent");
        await act(async () => text.resolve(JSON.stringify(snapshot(0))));

        expect(result.current).toMatchObject({ streamId: null, confirmedText: "" });
      });

      it.each([
        { label: "JSON이 아닌 글", payload: "안녕하세요" },
        { label: "형식이 틀린 스냅샷", payload: { ...snapshot(0), revision: -1 } },
      ])("'$label'이면 보이지 않는다", async ({ payload }) => {
        const { result, room } = await join();

        await stt(room, payload);

        expect(result.current).toMatchObject({ streamId: null, confirmedText: "" });
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("같은 캡처에서 이미 받은 차례 이하의 스냅샷은 버린다", async () => {
        const { result, room } = await join();
        await stt(room, snapshot(2));

        await stt(room, snapshot(2, { confirmedText: "늦게 온 글" }));

        expect(result.current.confirmedText).toBe("안녕하세요");
      });

      it("지난 캡처의 스냅샷이 늦게 와도 새 캡처를 덮어쓰지 않는다", async () => {
        const { result, room } = await join();
        await stt(room, snapshot(0));
        await stt(room, snapshot(0, { streamId: "capture-2", confirmedText: "다음 답변" }));

        await stt(room, snapshot(5, { confirmedText: "지난 답변" }));

        expect(result.current).toMatchObject({ streamId: "capture-2", confirmedText: "다음 답변" });
      });

      it("질문 음성이 시작되면 그때까지의 캡처는 늦게 와도 버린다", async () => {
        const { result, room } = await join();
        await stt(room, snapshot(0));
        await rpc(room, QUESTION_METHOD, question(4, "started"));

        await stt(room, snapshot(1, { confirmedText: "지난 답변 끝" }));

        expect(result.current.confirmedText).toBe("안녕하세요");
      });
    });
    describe("정리", () => {
      it("다시 연결한 뒤 이전 방이 보낸 스냅샷은 다 읽혀도 버린다", async () => {
        const { result, room } = await join();
        const text = deferred<string>();
        room.textHandler?.({ readAll: () => text.promise }, { identity: "agent" });

        act(() => result.current.retry());
        await flushPromises();
        await act(async () => text.resolve(JSON.stringify(snapshot(0))));

        expect(result.current).toMatchObject({ streamId: null, confirmedText: "" });
      });
    });
  });

  describe("듣는 중 끄덕임 정보", () => {
    describe("정상 처리", () => {
      it("자막 글이 바뀌면 지금 질문 순서 · 캡처 id · 그 시각으로 끄덕임 정보를 만든다", async () => {
        vi.spyOn(performance, "now").mockReturnValue(100);
        const { room, presented } = await join();

        await stt(room, snapshot(0));

        expect(presented().listening).toEqual({
          questionSeq: 3,
          streamId: "capture-1",
          speechAt: 100,
        });
      });
    });

    describe("상태 변화", () => {
      it.each([
        { label: "실패 스냅샷", next: snapshot(1, { state: "failed" }) },
        { label: "빈 자막", next: snapshot(1, { confirmedText: "", interimText: "  " }) },
      ])("'$label'이면 끄덕임 정보를 지운다", async ({ next }) => {
        const { room, presented } = await join();
        await stt(room, snapshot(0));

        await stt(room, next);

        expect(presented().listening).toBeNull();
      });

      it("지금 질문의 답변 상태를 받으면 끄덕임 정보를 지운다", async () => {
        const { room, presented } = await join();
        await stt(room, snapshot(0));

        await rpc(room, ANSWER_STATE_METHOD, answerState(3, "sttReconnecting"));

        expect(presented().listening).toBeNull();
      });

      it("답을 낸 질문이어도 새 캡처가 열리면 다시 끄덕임 정보를 만든다", async () => {
        const { room, presented } = await join();
        await stt(room, snapshot(0));
        await rpc(room, ANSWER_STATE_METHOD, answerState(3, "submitted"));

        await stt(room, snapshot(0, { streamId: "capture-2", confirmedText: "다시 말하면" }));

        expect(presented().listening).toMatchObject({ questionSeq: 3, streamId: "capture-2" });
      });
    });

    describe("입력 검증", () => {
      type Joined = Awaited<ReturnType<typeof join>>;
      it.each([
        {
          label: "같은 글이 다시 옴",
          arrange: async ({ room }: Joined) => stt(room, snapshot(0)),
          next: snapshot(1),
        },
        {
          label: "재접속 중",
          arrange: async ({ room }: Joined) => emit(room, "reconnecting"),
          next: snapshot(0),
        },
        {
          label: "연결 실패 뒤",
          arrange: async ({ room }: Joined) => emit(room, "disconnected"),
          next: snapshot(0),
        },
        {
          label: "답변 완료 응답 대기 중",
          arrange: async ({ room, result }: Joined) => {
            const response = deferred<string>();
            room.localParticipant.performRpc.mockReturnValue(response.promise);
            let submitting: Promise<SubmitAnswerResult> | undefined;
            act(() => {
              submitting = result.current.submitAnswer(3);
            });
            return async () => {
              await act(async () => {
                response.resolve(JSON.stringify({ accepted: false }));
                await submitting;
              });
            };
          },
          next: snapshot(0),
        },
        {
          label: "질문 음성 중",
          arrange: async ({ room }: Joined) => rpc(room, QUESTION_METHOD, question(3, "started")),
          next: snapshot(0),
        },
        {
          label: "답을 낸 질문",
          arrange: async ({ room }: Joined) =>
            rpc(room, ANSWER_STATE_METHOD, answerState(3, "submitted")),
          next: snapshot(0),
        },
      ])("'$label'이면 끄덕임 정보를 새로 만들지 않는다", async ({ arrange, next }) => {
        const now = vi.spyOn(performance, "now").mockReturnValue(100);
        const joined = await join();
        const finish = await arrange(joined);
        const before = joined.presented().listening;
        now.mockReturnValue(500);

        await stt(joined.room, next);

        expect(joined.presented().listening).toEqual(before);
        if (typeof finish === "function") await finish();
      });
    });
  });

  describe("화면 표시 정보", () => {
    describe("정상 처리", () => {
      it("질문 · 리액션 · 끄덕임 정보가 바뀌면 지금 질문 기준으로 묶어 onPresentation에 넘긴다", async () => {
        vi.spyOn(performance, "now").mockReturnValue(100);
        const { room, presented } = await join();

        await rpc(room, QUESTION_METHOD, question(3, "ended"));
        await rpc(room, REACTION_METHOD, reaction(3, 1));
        await stt(room, snapshot(0));

        expect(presented()).toEqual({
          question: question(3, "ended"),
          reaction: { message: reaction(3, 1), receivedAt: 100 },
          listening: { questionSeq: 3, streamId: "capture-1", speechAt: 100 },
        });
      });
    });

    describe("입력 검증", () => {
      it("화면이 아는 질문 순서보다 앞선 질문은 넘기지 않는다", async () => {
        const { room, presented } = await join();

        await rpc(room, QUESTION_METHOD, question(2, "ended"));

        expect(presented().question).toBeNull();
      });

      it("표시 중인 질문과 순서가 다른 리액션 · 끄덕임 정보는 넘기지 않는다", async () => {
        const { room, presented, update } = await join();
        await rpc(room, REACTION_METHOD, reaction(3, 1));
        await stt(room, snapshot(0));

        await update({ questionSeq: 4 });

        expect(presented().reaction).toBeNull();
        expect(presented().listening).toBeNull();
      });
    });

    describe("정리", () => {
      it("화면을 떠나면 onPresentation에 null을 넘긴다", async () => {
        const { onPresentation, unmount } = await join();

        unmount();

        expect(onPresentation).toHaveBeenLastCalledWith(null);
      });
    });
  });

  describe("리액션 메시지", () => {
    describe("정상 처리", () => {
      it("면접관이 보낸 지금 질문의 리액션을 받은 시각과 함께 반영한다", async () => {
        vi.spyOn(performance, "now").mockReturnValue(100);
        const { result, room } = await join();
        await rpc(room, QUESTION_METHOD, question(3, "ended"));

        await rpc(room, REACTION_METHOD, reaction(3, 1));

        expect(result.current.reaction).toEqual({ message: reaction(3, 1), receivedAt: 100 });
      });

      it("질문 메시지를 받기 전이면 화면이 아는 질문 순서의 리액션을 반영한다", async () => {
        const { result, room } = await join({ questionSeq: 3 });

        await rpc(room, REACTION_METHOD, reaction(3, 1));

        expect(result.current.reaction?.message).toEqual(reaction(3, 1));
      });
    });

    describe("상태 변화", () => {
      it("질문 음성이 시작되면 보이던 리액션과 끄덕임 정보를 지운다", async () => {
        const { result, room, presented } = await join();
        await rpc(room, QUESTION_METHOD, question(3, "ended"));
        await rpc(room, REACTION_METHOD, reaction(3, 1));
        await stt(room, snapshot(0));

        await rpc(room, QUESTION_METHOD, question(4, "started"));

        expect(result.current.reaction).toBeNull();
        expect(presented().listening).toBeNull();
      });
    });

    describe("입력 검증", () => {
      it.each([
        { label: "다른 참가자", payload: reaction(3, 1), caller: "other" },
        { label: "다른 면접", payload: reaction(3, 1, { sessionId: 56 }), caller: "agent" },
        { label: "형식 오류", payload: "{", caller: "agent" },
      ])("'$label'면 리액션을 버린다", async ({ payload, caller }) => {
        const { result, room } = await join();

        await rpc(room, REACTION_METHOD, payload, caller);

        expect(result.current.reaction).toBeNull();
      });

      type Joined = Awaited<ReturnType<typeof join>>;
      it.each([
        { label: "다른 질문", arrange: async () => {}, questionSeq: 2 },
        {
          label: "질문 음성 중",
          arrange: async ({ room }: Joined) => rpc(room, QUESTION_METHOD, question(3, "started")),
          questionSeq: 3,
        },
        {
          label: "답을 낸 질문",
          arrange: async ({ room }: Joined) =>
            rpc(room, ANSWER_STATE_METHOD, answerState(3, "submitted")),
          questionSeq: 3,
        },
        {
          label: "답변 완료 응답 대기 중",
          arrange: async ({ room, result }: Joined) => {
            const response = deferred<string>();
            room.localParticipant.performRpc.mockReturnValue(response.promise);
            let submitting: Promise<SubmitAnswerResult> | undefined;
            act(() => {
              submitting = result.current.submitAnswer(3);
            });
            return async () => {
              await act(async () => {
                response.resolve(JSON.stringify({ accepted: false }));
                await submitting;
              });
            };
          },
          questionSeq: 3,
        },
      ])("'$label'이면 리액션을 버린다", async ({ arrange, questionSeq }) => {
        const joined = await join();
        const finish = await arrange(joined);

        await rpc(joined.room, REACTION_METHOD, reaction(questionSeq, 1));

        expect(joined.result.current.reaction).toBeNull();
        if (typeof finish === "function") await finish();
      });

      it("채팅이면 말 끊기가 있는 리액션을 버린다", async () => {
        const { result, room } = await join({ listenOnly: true });

        await rpc(
          room,
          REACTION_METHOD,
          reaction(3, 1, {
            interrupt: { reason: "TOO_LONG", text: "잠시만요, 핵심만 말씀해 주세요." },
          }),
        );

        expect(result.current.reaction).toBeNull();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("같은 질문에서 이미 받은 순번 이하의 리액션은 버린다", async () => {
        const { result, room } = await join();
        await rpc(room, REACTION_METHOD, reaction(3, 2));

        await rpc(
          room,
          REACTION_METHOD,
          reaction(3, 2, { attitude: { interest: 0.1, trust: 0.1 } }),
        );

        expect(result.current.reaction?.message).toEqual(reaction(3, 2));
      });
    });
    describe("정리", () => {
      it("다시 연결한 뒤 이전 방이 보낸 리액션은 버린다", async () => {
        const { result, room } = await join();
        const previousRoom = room.rpcHandlers.get(REACTION_METHOD)!;

        act(() => result.current.retry());
        await flushPromises();
        await act(async () => {
          await previousRoom({ callerIdentity: "agent", payload: JSON.stringify(reaction(3, 1)) });
        });

        expect(result.current.reaction).toBeNull();
      });
    });
  });

  describe("인상 점수 메시지", () => {
    describe("정상 처리", () => {
      it("면접관이 보낸 이 면접의 점수를 받은 차례대로 쌓고 얼굴을 확인할 수 없다는 null도 쌓는다", async () => {
        const { result, room } = await join();

        await rpc(room, ATTITUDE_METHOD, attitude(72));
        await rpc(room, ATTITUDE_METHOD, attitude(null));
        await rpc(room, ATTITUDE_METHOD, attitude(75));

        expect(result.current.attitude.map((sample) => sample.score)).toEqual([72, null, 75]);
      });
    });

    describe("상태 변화", () => {
      it("새 질문 음성이 시작되면 쌓인 점수를 지운다", async () => {
        const { result, room } = await join();
        await rpc(room, ATTITUDE_METHOD, attitude(72));

        await rpc(room, QUESTION_METHOD, question(4, "started"));

        expect(result.current.attitude).toEqual([]);
      });

      it("연결이 끊기면 쌓인 점수를 지운다", async () => {
        const { result, room } = await join();
        await rpc(room, ATTITUDE_METHOD, attitude(72));

        emit(room, "disconnected");

        expect(result.current.attitude).toEqual([]);
      });

      it("다시 연결하면 지난 연결에서 받은 점수를 지운다", async () => {
        const { result, room } = await join();
        await rpc(room, ATTITUDE_METHOD, attitude(72));

        act(() => result.current.retry());
        await flushPromises();

        expect(result.current.attitude).toEqual([]);
      });
    });

    describe("입력 검증", () => {
      it.each([
        { label: "다른 참가자", payload: attitude(72), caller: "other" },
        { label: "다른 면접", payload: attitude(72, { sessionId: 56 }), caller: "agent" },
        { label: "형식 오류", payload: "{", caller: "agent" },
      ])("'$label'면 점수를 버린다", async ({ payload, caller }) => {
        const { result, room } = await join();

        await rpc(room, ATTITUDE_METHOD, payload, caller);

        expect(result.current.attitude).toEqual([]);
      });

      it("질문 음성이 나오는 동안 온 점수는 버린다", async () => {
        const { result, room } = await join();
        await rpc(room, QUESTION_METHOD, question(3, "started"));

        await rpc(room, ATTITUDE_METHOD, attitude(72));

        expect(result.current.attitude).toEqual([]);
      });

      it("채팅이면 인상 점수를 받지 않는다", async () => {
        const { room } = await join({ listenOnly: true });

        expect(room.rpcHandlers.has(ATTITUDE_METHOD)).toBe(false);
      });
    });

    describe("경계값", () => {
      type Sample = [score: number | null, receivedAt: number];
      it.each<{ label: string; at: number; expected: Sample[] }>([
        {
          label: "딱 30초 전",
          at: 31_000,
          expected: [
            [60, 1_000],
            [70, 31_000],
          ],
        },
        {
          label: "30초를 1ms 넘긴",
          at: 31_001,
          expected: [
            [60, 1_001],
            [70, 31_001],
          ],
        },
      ])(
        "새 점수를 받을 때 첫 점수가 '$label' 것이면 30초 안의 점수만 남기고 그 직전 점수를 30초 경계로 옮긴다",
        async ({ at, expected }) => {
          const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
          const { result, room } = await join();
          await rpc(room, ATTITUDE_METHOD, attitude(60));

          now.mockReturnValue(at);
          await rpc(room, ATTITUDE_METHOD, attitude(70));

          expect(
            result.current.attitude.map(({ score, receivedAt }) => [score, receivedAt]),
          ).toEqual(expected);
        },
      );

      it("30초보다 오래된 점수가 여럿이면 마지막 하나만 경계로 옮기고 나머지는 버린다", async () => {
        const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
        const { result, room } = await join();
        await rpc(room, ATTITUDE_METHOD, attitude(60));
        now.mockReturnValue(2_000);
        await rpc(room, ATTITUDE_METHOD, attitude(80));

        now.mockReturnValue(70_000);
        await rpc(room, ATTITUDE_METHOD, attitude(null));

        expect(result.current.attitude.map(({ score, receivedAt }) => [score, receivedAt])).toEqual(
          [
            [80, 40_000],
            [null, 70_000],
          ],
        );
      });
    });
  });

  describe("질문 메시지", () => {
    describe("정상 처리", () => {
      it("면접관이 보낸 이 면접의 질문을 반영한다", async () => {
        const { result, room } = await join();

        await rpc(room, QUESTION_METHOD, question(3, "started"));

        expect(result.current.question).toEqual(question(3, "started"));
      });

      it.each([{ speech: "ended" }, { speech: "failed" }] as const)(
        "같은 질문의 음성 시작 뒤 '$speech' 소식을 반영한다",
        async ({ speech }) => {
          const { result, room } = await join();
          await rpc(room, QUESTION_METHOD, question(3, "started"));

          await rpc(room, QUESTION_METHOD, question(3, speech));

          expect(result.current.question).toEqual(question(3, speech));
        },
      );
    });

    describe("입력 검증", () => {
      it.each([
        { label: "다른 참가자", payload: question(3, "started"), caller: "other" },
        { label: "다른 면접", payload: question(3, "started", 56), caller: "agent" },
        { label: "형식 오류", payload: { ...question(3, "started"), seq: 6 }, caller: "agent" },
      ])("'$label'면 질문을 버린다", async ({ payload, caller }) => {
        const { result, room } = await join();

        await rpc(room, QUESTION_METHOD, payload, caller);

        expect(result.current.question).toBeNull();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it.each([
        { label: "앞선 순서의 질문", late: question(2, "started") },
        { label: "음성이 끝난 같은 질문의 소식", late: question(3, "started") },
      ])("'$label'이 늦게 오면 버린다", async ({ late }) => {
        const { result, room } = await join();
        await rpc(room, QUESTION_METHOD, question(3, "ended"));

        await rpc(room, QUESTION_METHOD, late);

        expect(result.current.question).toEqual(question(3, "ended"));
      });
    });
    describe("정리", () => {
      it("다시 연결한 뒤 이전 방이 보낸 질문은 버린다", async () => {
        const { result, room } = await join();
        const previousRoom = room.rpcHandlers.get(QUESTION_METHOD)!;

        act(() => result.current.retry());
        await flushPromises();
        await act(async () => {
          await previousRoom({
            callerIdentity: "agent",
            payload: JSON.stringify(question(3, "started")),
          });
        });

        expect(result.current.question).toBeNull();
      });
    });
  });

  describe("답변 상태 받기", () => {
    describe("정상 처리", () => {
      it("면접관이 보낸 이 면접의 답변 상태를 onAnswerState로 넘긴다", async () => {
        const onAnswerState = vi.fn();
        const { room } = await join({ onAnswerState });

        await rpc(room, ANSWER_STATE_METHOD, answerState(3, "timedOut"));

        expect(onAnswerState).toHaveBeenCalledWith(answerState(3, "timedOut"));
      });

      it("넘기는 함수가 바뀌면 다시 입장하지 않고 최신 함수로 넘긴다", async () => {
        const first = vi.fn();
        const latest = vi.fn();
        const { room, update } = await join({ onAnswerState: first });
        await update({ onAnswerState: latest });

        await rpc(room, ANSWER_STATE_METHOD, answerState(3, "timedOut"));

        expect(sdk.FakeRoom.instances).toHaveLength(1);
        expect(first).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(1);
      });
    });

    describe("상태 변화", () => {
      it.each([
        { state: "autoSubmitted" },
        { state: "submitted" },
        { state: "submitFailed" },
      ] as const)(
        "'$state'면 지금 질문을 닫아 그 질문의 리액션 · 끄덕임을 지우고 뒤에 온 리액션도 버린다",
        async ({ state }) => {
          const { result, room, presented } = await join();
          await rpc(room, REACTION_METHOD, reaction(3, 1));
          await stt(room, snapshot(0));

          await rpc(room, ANSWER_STATE_METHOD, answerState(3, state));
          await rpc(room, REACTION_METHOD, reaction(3, 2));

          expect(result.current.reaction).toBeNull();
          expect(presented().listening).toBeNull();
        },
      );

      it.each([
        { state: "sttReconnecting" },
        { state: "sttFailed" },
        { state: "timedOut" },
      ] as const)("'$state'이면 질문을 닫지 않는다", async ({ state }) => {
        const { result, room } = await join();

        await rpc(room, ANSWER_STATE_METHOD, answerState(3, state));
        await rpc(room, REACTION_METHOD, reaction(3, 1));

        expect(result.current.reaction).not.toBeNull();
      });

      it("지난 질문의 답변 상태면 질문을 닫지 않고 끄덕임 정보도 두지만 onAnswerState로는 넘긴다", async () => {
        const onAnswerState = vi.fn();
        const { result, room, presented } = await join({ onAnswerState });
        await stt(room, snapshot(0));

        await rpc(room, ANSWER_STATE_METHOD, answerState(2, "submitted"));
        await rpc(room, REACTION_METHOD, reaction(3, 1));

        expect(presented().listening).not.toBeNull();
        expect(result.current.reaction).not.toBeNull();
        expect(onAnswerState).toHaveBeenCalledWith(answerState(2, "submitted"));
      });
    });

    describe("입력 검증", () => {
      it.each([
        { label: "다른 면접", payload: answerState(3, "submitted", 56), caller: "agent" },
        { label: "면접관이 아닌 참가자", payload: answerState(3, "submitted"), caller: "other" },
        {
          label: "형식 오류",
          payload: { ...answerState(3, "submitted"), state: "done" },
          caller: "agent",
        },
      ])("'$label'면 넘기지 않는다", async ({ payload, caller }) => {
        const onAnswerState = vi.fn();
        const { room } = await join({ onAnswerState });

        await rpc(room, ANSWER_STATE_METHOD, payload, caller);

        expect(onAnswerState).not.toHaveBeenCalled();
      });
    });

    describe("정리", () => {
      it("화면을 떠난 뒤 온 답변 상태는 넘기지 않는다", async () => {
        const onAnswerState = vi.fn();
        const { room, unmount } = await join({ onAnswerState });
        const onState = room.rpcHandlers.get(ANSWER_STATE_METHOD)!;

        unmount();
        await act(async () => {
          await onState({
            callerIdentity: "agent",
            payload: JSON.stringify(answerState(3, "timedOut")),
          });
        });

        expect(onAnswerState).not.toHaveBeenCalled();
      });
    });
  });

  describe("답변 완료 보내기", () => {
    describe("정상 처리", () => {
      it("면접관이 받으면 accepted를 돌려주고 그 질문을 닫아 뒤에 온 리액션을 버린다", async () => {
        const { result, room } = await join();

        let outcome: SubmitAnswerResult | undefined;
        await act(async () => {
          outcome = await result.current.submitAnswer(3);
        });
        await rpc(room, REACTION_METHOD, reaction(3, 1));

        expect(outcome).toBe("accepted");
        expect(result.current.reaction).toBeNull();
      });
    });

    describe("상태 변화", () => {
      it("보내면 응답을 기다리기 전에 리액션 · 끄덕임 정보를 지운다", async () => {
        const { result, room, presented } = await join();
        await rpc(room, REACTION_METHOD, reaction(3, 1));
        await stt(room, snapshot(0));
        const response = deferred<string>();
        room.localParticipant.performRpc.mockReturnValue(response.promise);

        let submitting: Promise<SubmitAnswerResult> | undefined;
        act(() => {
          submitting = result.current.submitAnswer(3);
        });

        expect(result.current.reaction).toBeNull();
        expect(presented().listening).toBeNull();
        await act(async () => {
          response.resolve(JSON.stringify({ accepted: true }));
          await submitting;
        });
      });

      it("거절된 뒤에는 새 발화에 다시 끄덕임 정보를 만든다", async () => {
        const { result, room, presented } = await join();
        room.localParticipant.performRpc.mockResolvedValue(JSON.stringify({ accepted: false }));
        await act(async () => {
          await result.current.submitAnswer(3);
        });

        await stt(room, snapshot(0));

        expect(presented().listening).toMatchObject({ questionSeq: 3, streamId: "capture-1" });
      });
    });

    describe("오류 처리", () => {
      it.each([
        { label: "accepted false", response: JSON.stringify({ accepted: false }) },
        { label: "형식이 틀린 응답", response: JSON.stringify({ accepted: "yes" }) },
        { label: "JSON이 아닌 응답", response: "ok" },
      ])("'$label'이면 rejected를 돌려준다", async ({ response }) => {
        const { result, room } = await join();
        room.localParticipant.performRpc.mockResolvedValue(response);

        let outcome: SubmitAnswerResult | undefined;
        await act(async () => {
          outcome = await result.current.submitAnswer(3);
        });

        expect(outcome).toBe("rejected");
      });

      it("거절 코드(ANSWER_REJECTED_CODES[0])면 rejected를 돌려준다", async () => {
        const { result, room } = await join();
        room.localParticipant.performRpc.mockRejectedValue(
          new sdk.RpcError(ANSWER_REJECTED_CODES[0], "nothing said"),
        );

        let outcome: SubmitAnswerResult | undefined;
        await act(async () => {
          outcome = await result.current.submitAnswer(3);
        });

        expect(outcome).toBe("rejected");
      });

      it("그 밖의 RPC 오류면 failed를 돌려준다", async () => {
        const { result, room } = await join();
        room.localParticipant.performRpc.mockRejectedValue(new sdk.RpcError(1500, "timeout"));

        let outcome: SubmitAnswerResult | undefined;
        await act(async () => {
          outcome = await result.current.submitAnswer(3);
        });

        expect(outcome).toBe("failed");
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("응답을 기다리는 사이 다시 연결했으면 failed를 돌려준다", async () => {
        const { result, room } = await join();
        const response = deferred<string>();
        room.localParticipant.performRpc.mockReturnValue(response.promise);
        let submitting: Promise<SubmitAnswerResult> | undefined;
        act(() => {
          submitting = result.current.submitAnswer(3);
        });

        act(() => result.current.retry());
        await flushPromises();
        let outcome: SubmitAnswerResult | undefined;
        await act(async () => {
          response.resolve(JSON.stringify({ accepted: true }));
          outcome = await submitting;
        });

        expect(outcome).toBe("failed");
      });

      it("두 번 겹쳐 보내면 둘 다 끝날 때까지 리액션 · 끄덕임 정보를 막는다", async () => {
        const { result, room, presented } = await join();
        const first = deferred<string>();
        const second = deferred<string>();
        room.localParticipant.performRpc
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise);
        let submissions: Promise<SubmitAnswerResult>[] = [];
        act(() => {
          submissions = [result.current.submitAnswer(3), result.current.submitAnswer(3)];
        });

        await act(async () => {
          first.resolve(JSON.stringify({ accepted: false }));
          await submissions[0];
        });
        await rpc(room, REACTION_METHOD, reaction(3, 1));
        await stt(room, snapshot(0));
        expect(result.current.reaction).toBeNull();
        expect(presented().listening).toBeNull();
        await act(async () => {
          second.resolve(JSON.stringify({ accepted: false }));
          await submissions[1];
        });
        await rpc(room, REACTION_METHOD, reaction(3, 2));

        expect(result.current.reaction?.message).toEqual(reaction(3, 2));
      });
    });
  });

  describe("채팅 입력 신호", () => {
    describe("정상 처리", () => {
      it("채팅이면 지금 방의 면접관에게 입력 신호를 보낸다", async () => {
        const { result, room } = await join({ listenOnly: true });

        await act(async () => result.current.sendChatInput(3, 1, "트랜잭션은", 300));

        expect(room.localParticipant.performRpc).toHaveBeenCalledTimes(1);
        expect(room.localParticipant.performRpc.mock.calls[0][0].destinationIdentity).toBe("agent");
      });
    });

    describe("오류 처리", () => {
      it("보내지 못해도 오류를 던지지 않는다", async () => {
        const { result, room } = await join({ listenOnly: true });
        room.localParticipant.performRpc.mockRejectedValue(new sdk.RpcError(1500, "timeout"));

        await expect(
          result.current.sendChatInput(3, 1, "트랜잭션은", 300),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("인상 판단 사진", () => {
    const JPEG = { arrayBuffer: async () => new ArrayBuffer(4) } as Blob;

    describe("정상 처리", () => {
      it("화상이면 사진을 면접관에게만 보내고 찍은 뒤 지난 시간을 ageMs로 붙인다", async () => {
        vi.spyOn(performance, "now").mockReturnValue(1500);
        const { result, room } = await join();

        await act(async () => result.current.sendFrame(JPEG, 1000));

        expect(room.localParticipant.sendBytes).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          expect.objectContaining({
            destinationIdentities: ["agent"],
            attributes: { ageMs: "500" },
          }),
        );
      });
    });

    describe("경계값", () => {
      it("찍은 시각이 지금보다 늦으면 ageMs를 0으로 붙인다", async () => {
        vi.spyOn(performance, "now").mockReturnValue(1000);
        const { result, room } = await join();

        await act(async () => result.current.sendFrame(JPEG, 1200));

        expect(room.localParticipant.sendBytes).toHaveBeenCalledWith(
          expect.any(Uint8Array),
          expect.objectContaining({ attributes: { ageMs: "0" } }),
        );
      });
    });

    describe("오류 처리", () => {
      it("보내지 못해도 오류를 던지지 않는다", async () => {
        const { result, room } = await join();
        room.localParticipant.sendBytes.mockRejectedValue(new Error("send failed"));

        await expect(result.current.sendFrame(JPEG, 1000)).resolves.toBeUndefined();
      });
    });
  });
  describe("그룹 면접방", () => {
    /** 면접방 정보(API 명세 10.11 예시). turnVersion만 바꿔 쓴다 */
    const roomInfo = (turnVersion: number, phase = "ANSWERING") =>
      JSON.stringify({
        turnVersion,
        serverTime: "2026-11-04T14:03:00.120+09:00",
        groupStatus: "IN_PROGRESS",
        round: 2,
        phase,
        turn: {
          sessionId: 56,
          seq: 6,
          kind: "FOLLOWUP",
          baseIndex: null,
          announce: "FULL",
          deadlineAt: "2026-11-04T14:05:02.000+09:00",
          extended: false,
          followupsLeft: 0,
        },
        participants: [
          { sessionId: 55, turnOrder: 1, state: "PRESENT", absentUntil: null, endReason: null },
        ],
        upcoming: [],
      });

    describe("정상 처리", () => {
      it("들어갈 때 방에 있던 정보를 받는다", async () => {
        sdk.FakeRoom.prepare = (room) => {
          room.metadata = roomInfo(17);
        };

        const { result } = await join({ group: true });

        expect(result.current.roomInfo?.info.turnVersion).toBe(17);
      });

      it("다른 참가자 차례의 질문(다른 sessionId · 꼬리질문 6번)도 받는다", async () => {
        const { result, room } = await join({ group: true });

        await rpc(room, QUESTION_METHOD, { ...question(6, "started"), sessionId: 56 });

        expect(result.current.question).toMatchObject({ sessionId: 56, seq: 6 });
      });
    });

    describe("상태 변화", () => {
      it("들어갈 때 방에 있던 정보로는 시계 차이를 재지 않고(만든 시각을 몰라), 바뀐 순간 받은 정보로 잰다", async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-04T14:03:10.120+09:00") });
        sdk.FakeRoom.prepare = (room) => {
          room.metadata = roomInfo(17);
        };
        const { result, room } = await join({ group: true });
        expect(result.current.roomInfo?.offsetMs).toBe(0);

        emit(room, "roomMetadataChanged", roomInfo(18));

        expect(result.current.roomInfo?.offsetMs).toBe(-10_000);
      });

      it("답변 중 나갔다 돌아온 사람에게 같은 순서로 다시 물으면(새 말하기 시작) 새 질문으로 받는다", async () => {
        const { result, room } = await join({ group: true });
        await rpc(room, QUESTION_METHOD, question(3, "started", 56));
        await rpc(room, QUESTION_METHOD, question(3, "ended", 56));

        await rpc(room, QUESTION_METHOD, question(3, "started", 56));

        expect(result.current.question).toMatchObject({ sessionId: 56, seq: 3, speech: "started" });
      });

      it("다음 답변자 차례 뒤에 늦게 온 앞 답변자의 말하기 끝 소식은 버린다", async () => {
        const { result, room } = await join({ group: true });
        await rpc(room, QUESTION_METHOD, question(3, "started", 56));
        await rpc(room, QUESTION_METHOD, question(3, "started", 57));

        await rpc(room, QUESTION_METHOD, question(3, "ended", 56));

        expect(result.current.question).toMatchObject({ sessionId: 57, speech: "started" });
      });

      it("방 정보가 바뀌면 새 정보로 바꾼다", async () => {
        const { result, room } = await join({ group: true });

        emit(room, "roomMetadataChanged", roomInfo(18, "DECIDING"));

        expect(result.current.roomInfo?.info).toMatchObject({ turnVersion: 18, phase: "DECIDING" });
      });

      it("다시 들어가면 지난 방 정보를 지우고 새 방의 정보를 기다린다", async () => {
        sdk.FakeRoom.prepare = (room) => {
          room.metadata = roomInfo(17);
        };
        const { result } = await join({ group: true });
        sdk.FakeRoom.prepare = null;

        act(() => result.current.retry());
        await flushPromises();

        expect(result.current.roomInfo).toBeNull();
      });

      it("리액션 순서는 답변자마다 따로 센다(같은 질문 순서여도 다음 답변자의 첫 리액션을 받는다)", async () => {
        const { result, room } = await join({ group: true });
        await rpc(room, QUESTION_METHOD, question(3, "ended", 56));
        await rpc(room, REACTION_METHOD, reaction(3, 5, { sessionId: 56 }));
        await rpc(room, QUESTION_METHOD, question(3, "started", 57));
        await rpc(room, QUESTION_METHOD, question(3, "ended", 57));

        await rpc(room, REACTION_METHOD, reaction(3, 1, { sessionId: 57 }));

        expect(result.current.reaction?.message).toMatchObject({ sessionId: 57, seq: 1 });
      });

      it("내가 답을 낸 질문과 순서가 같아도 다른 답변자의 질문에 대한 리액션은 받는다", async () => {
        const { result, room } = await join({ group: true });
        await rpc(room, QUESTION_METHOD, question(3, "ended"));
        await rpc(room, ANSWER_STATE_METHOD, answerState(3, "submitted"));
        await rpc(room, QUESTION_METHOD, question(3, "started", 56));
        await rpc(room, QUESTION_METHOD, question(3, "ended", 56));

        await rpc(room, REACTION_METHOD, reaction(3, 1, { sessionId: 56 }));

        expect(result.current.reaction?.message).toMatchObject({ sessionId: 56, questionSeq: 3 });
      });

      it("답변자가 바뀌면 앞 사람 질문보다 순서가 작아도 새 질문으로 받는다", async () => {
        const { result, room } = await join({ group: true });
        await rpc(room, QUESTION_METHOD, { ...question(4, "ended"), sessionId: 56 });

        await rpc(room, QUESTION_METHOD, { ...question(2, "started"), sessionId: 57 });

        expect(result.current.question).toMatchObject({ sessionId: 57, seq: 2 });
      });
    });

    describe("입력 검증", () => {
      it.each([
        { label: "가진 것과 같은 차례 번호", metadata: roomInfo(17) },
        { label: "형식 오류", metadata: "{" },
      ])("'$label'인 방 정보는 버린다", async ({ metadata }) => {
        sdk.FakeRoom.prepare = (room) => {
          room.metadata = roomInfo(17);
        };
        const { result, room } = await join({ group: true });

        emit(room, "roomMetadataChanged", metadata);

        expect(result.current.roomInfo?.info.phase).toBe("ANSWERING");
      });

      it("개인 면접이면 방 정보를 받지 않는다", async () => {
        sdk.FakeRoom.prepare = (room) => {
          room.metadata = roomInfo(17);
        };

        const { result } = await join();

        expect(result.current.roomInfo).toBeNull();
      });

      it("앞 답변자의 지난 질문 메시지가 다음 답변자 차례 뒤에 늦게 오면 버린다", async () => {
        const { result, room } = await join({ group: true });
        await rpc(room, QUESTION_METHOD, question(4, "started", 56));
        await rpc(room, QUESTION_METHOD, question(2, "started", 57));

        await rpc(room, QUESTION_METHOD, question(3, "started", 56));

        expect(result.current.question).toMatchObject({ sessionId: 57, seq: 2 });
      });

      it("지금 답변자가 아닌 사람의 질문에 대한 리액션은 버린다", async () => {
        const { result, room } = await join({ group: true });
        await rpc(room, QUESTION_METHOD, { ...question(3, "ended"), sessionId: 56 });

        await rpc(room, REACTION_METHOD, { ...reaction(3, 1), sessionId: 57 });

        expect(result.current.reaction).toBeNull();
      });
    });
  });
});
