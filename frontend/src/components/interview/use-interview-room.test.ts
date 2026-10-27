import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STT_TOPIC } from "@/lib/interview/transcript";

import { useInterviewRoom } from "./use-interview-room";

// 기준: 웹 Swagger 5.14 · 승인된 STT 스냅샷 계약. API와 RTC 경계만 대체한다.
// · 웹 Swagger 5.4(채팅도 면접방에 들어간다(송출 없이 수신·메시지만))
// · API 명세 면접방 메시지(answer.state 수신 · answer.submit 전송) · AI 명세 6.3(RPC 오류 2001 · 2002)
const sdk = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  type RpcHandler = (data: { callerIdentity: string; payload: string }) => Promise<string>;
  class FakeRoom {
    static instances: FakeRoom[] = [];
    handlers = new Map<string, Handler>();
    textHandler?: (
      reader: { readAll: () => Promise<string> },
      sender: { identity: string },
    ) => void;
    remoteParticipants = new Map([
      ["agent", { identity: "agent", isAgent: true }],
      ["other", { identity: "other", isAgent: false }],
    ]);
    localParticipant = {
      publishTrack: vi.fn<(track: unknown, options?: unknown) => Promise<void>>(async () => {}),
      unpublishTrack: vi.fn(async () => {}),
      performRpc: vi.fn<(params: unknown) => Promise<string>>(async () =>
        JSON.stringify({ accepted: true }),
      ),
    };
    rpcHandlers = new Map<string, RpcHandler>();
    registerRpcMethod = vi.fn((method: string, handler: RpcHandler) => {
      this.rpcHandlers.set(method, handler);
    });
    unregisterRpcMethod = vi.fn((method: string) => {
      this.rpcHandlers.delete(method);
    });
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn(async () => {});
    registerTextStreamHandler = vi.fn((_topic: string, handler: FakeRoom["textHandler"]) => {
      this.textHandler = handler;
    });
    unregisterTextStreamHandler = vi.fn();
    removeAllListeners = vi.fn();
    constructor(readonly options: unknown) {
      FakeRoom.instances.push(this);
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
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
  },
  Track: {
    Source: { Microphone: "microphone", Camera: "camera" },
    Kind: { Audio: "audio", Video: "video" },
  },
}));
vi.mock("@/lib/interview/actions", () => ({ issueRoomToken: sdk.issueRoomToken }));

function media({ withCamera = false } = {}) {
  const microphone = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn() });
  const camera = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn() });
  const stream = {
    getAudioTracks: () => [microphone],
    getVideoTracks: () => (withCamera ? [camera] : []),
  } as unknown as MediaStream;
  return { stream, microphone, camera };
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

async function deliver(
  room: InstanceType<typeof sdk.FakeRoom>,
  payload: unknown,
  sender = "agent",
) {
  await act(async () => {
    room.textHandler?.({ readAll: async () => JSON.stringify(payload) }, { identity: sender });
  });
}

beforeEach(() => {
  sdk.FakeRoom.instances = [];
  sdk.issueRoomToken.mockReset().mockResolvedValue({
    ok: true,
    url: "wss://room.test",
    token: "room-token",
    expiresAt: "2026-10-23T15:00:00+09:00",
  });
});
afterEach(cleanup);

describe("자동 끄덕임의 발화 정보", () => {
  afterEach(() => vi.restoreAllMocks());
  async function joined(listenOnly = false) {
    const { stream } = media();
    const onPresentation = vi.fn();
    const hook = renderHook(
      ({ seq }) =>
        useInterviewRoom(55, listenOnly ? null : stream, {
          listenOnly,
          questionSeq: seq,
          onPresentation,
        }),
      { initialProps: { seq: 3 } },
    );
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    const activity = () => onPresentation.mock.lastCall?.[0]?.listening;
    return { ...hook, room, activity };
  }
  it("새 자막에만 시각을 기록하고 확정 처리·중복 갱신은 대기를 연장하지 않는다", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    const { room, activity } = await joined();
    await deliver(room, snapshot(0, { confirmedText: "", interimText: "" }));
    expect(activity()).toBeNull();
    await deliver(room, snapshot(1));
    expect(activity()).toEqual({ questionSeq: 3, streamId: "capture-1", speechAt: 100 });
    now.mockReturnValue(500);
    await deliver(room, snapshot(2, { confirmedText: "안녕하세요 저는", interimText: "" }));
    expect(activity().speechAt).toBe(100);
    await deliver(room, snapshot(3, { interimText: " 저는 개발자입니다" }));
    expect(activity().speechAt).toBe(500);
    await deliver(room, snapshot(2, { interimText: "과거 결과" }));
    expect(activity().speechAt).toBe(500);
    await deliver(room, snapshot(0, { streamId: "capture-2", confirmedText: "", interimText: "" }));
    expect(activity()).toBeNull();
  });
  it("질문 전환 때 이전 발화를 폐기하고 새 질문의 캡처만 반영한다", async () => {
    const { room, activity, rerender } = await joined();
    await deliver(room, snapshot(1));
    const question = async (speech: string) =>
      act(async () => {
        await room.rpcHandlers.get("interview.question")!({
          callerIdentity: "agent",
          payload: JSON.stringify({
            type: "question",
            sessionId: 55,
            seq: 4,
            content: "다음 질문",
            speech,
            alignment: null,
          }),
        });
      });
    await question("started");
    expect(activity()).toBeNull();
    await deliver(room, snapshot(0, { streamId: "capture-2", interimText: " 질문 중 소리" }));
    expect(activity()).toBeNull();
    await question("ended");
    await deliver(room, snapshot(2, { interimText: "지난 답변" }));
    expect(activity()).toBeNull();
    await deliver(room, snapshot(1, { streamId: "capture-2" }));
    expect(activity().questionSeq).toBe(4);
    rerender({ seq: 5 });
    expect(activity()).toBeNull();
    expect(sdk.FakeRoom.instances).toHaveLength(1);
  });
  it.each([
    "sttFailed",
    "reconnecting",
    "disconnected",
    "manualSubmit",
    "autoSubmitted",
    "submitted",
    "submitFailed",
  ])("%s 상태에서는 자동 끄덕임을 취소한다", async (event) => {
    const { room, activity, result } = await joined();
    await deliver(room, snapshot(1));
    expect(activity()).not.toBeNull();
    if (event === "sttFailed") await deliver(room, snapshot(2, { state: "failed" }));
    else if (event === "manualSubmit")
      await act(async () => {
        await result.current.submitAnswer(3);
      });
    else if (["autoSubmitted", "submitted", "submitFailed"].includes(event))
      await act(async () => {
        await room.rpcHandlers.get("interview.answerState")!({
          callerIdentity: "agent",
          payload: JSON.stringify({ type: "answer.state", sessionId: 55, seq: 3, state: event }),
        });
      });
    else act(() => room.handlers.get(event)?.());
    expect(activity()).toBeNull();
    if (event !== "sttFailed") {
      await deliver(room, snapshot(3, { interimText: "지연된 결과" }));
      expect(activity()).toBeNull();
    }
  });
  it("수동 제출 응답을 기다리는 동안 발화 정보를 차단하고 거절 후 새 발화에는 다시 반응한다", async () => {
    const { room, activity, result } = await joined();
    await deliver(room, snapshot(1));
    let finish!: (value: string) => void;
    room.localParticipant.performRpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<string>;
    act(() => {
      pending = result.current.submitAnswer(3);
    });
    expect(activity()).toBeNull();
    await deliver(room, snapshot(2, { interimText: "전송 대기 중" }));
    expect(activity()).toBeNull();
    await act(async () => {
      finish(JSON.stringify({ accepted: false }));
      expect(await pending).toBe("rejected");
    });
    await deliver(room, snapshot(3, { interimText: "추가 답변" }));
    expect(activity()).not.toBeNull();
  });
  it.each(["sttReconnecting", "sttFailed", "timedOut"])(
    "%s 알림을 수신하면 대기 중인 끄덕임을 취소한다",
    async (state) => {
      const { room, activity } = await joined();
      await deliver(room, snapshot(1));
      expect(activity()).not.toBeNull();
      await act(async () => {
        await room.rpcHandlers.get("interview.answerState")!({
          callerIdentity: "agent",
          payload: JSON.stringify({ type: "answer.state", sessionId: 55, seq: 3, state }),
        });
      });
      expect(activity()).toBeNull();
    },
  );
  it("채팅의 자막 메시지로는 자동 끄덕임을 시작하지 않는다", async () => {
    const { room, activity } = await joined(true);
    await deliver(room, snapshot(1));
    expect(activity()).toBeNull();
  });
});

describe("리액션 메시지 수신", () => {
  const message = (patch: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "reaction",
      sessionId: 55,
      questionSeq: 3,
      seq: 1,
      reaction: {
        type: "expression",
        expression: "smile",
        gesture: null,
        intensity: 0.4,
        durationMs: 1200,
      },
      attitude: { interest: 0.7, trust: 0.3 },
      interrupt: null,
      ...patch,
    });
  async function joined(listenOnly = false) {
    const { stream } = media();
    const hook = renderHook(() =>
      useInterviewRoom(55, listenOnly ? null : stream, { listenOnly, questionSeq: 3 }),
    );
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    const receive = (payload = message(), callerIdentity = "agent") =>
      act(async () => {
        expect(await room.rpcHandlers.get("interview.reaction")!({ callerIdentity, payload })).toBe(
          "",
        );
      });
    return { ...hook, room, receive };
  }
  it("같은 면접의 새로운 순번만 반영한다", async () => {
    const { result, room, receive } = await joined();
    await receive(message({ seq: 2 }));
    await receive();
    expect(result.current.reaction?.message.seq).toBe(2);
    await receive(message({ seq: 2, attitude: { interest: 0.1, trust: 1 } }));
    expect(result.current.reaction?.message.seq).toBe(2);
    expect(result.current.reaction?.message.attitude).toEqual({ interest: 0.7, trust: 0.3 });
    await act(async () => {
      await room.rpcHandlers.get("interview.answerState")!({
        callerIdentity: "agent",
        payload: JSON.stringify({
          type: "answer.state",
          sessionId: 55,
          seq: 2,
          state: "submitted",
        }),
      });
    });
    expect(result.current.reaction?.message.seq).toBe(2);
  });
  it("다른 참가자·면접·질문과 형식 오류를 폐기한다", async () => {
    const { result, receive } = await joined();
    await receive(message(), "other");
    await receive(message({ sessionId: 56 }));
    await receive(message({ questionSeq: 4 }));
    await receive(message({ seq: true }));
    await receive(message({ attitude: { interest: 2, trust: 0.5 } }));
    await receive(message({ reaction: { type: "gesture", gesture: "nod" } }));
    await receive("not json");
    expect(result.current.reaction).toBeNull();
  });
  it("제출 이후 도착한 반응을 폐기하고 연결 정리 시 수신을 해제한다", async () => {
    const { result, room, receive, unmount } = await joined();
    await receive();
    expect(result.current.reaction).not.toBeNull();
    await act(async () => {
      await result.current.submitAnswer(3);
    });
    await receive(message({ seq: 2 }));
    expect(result.current.reaction).toBeNull();
    unmount();
    expect(room.unregisterRpcMethod).toHaveBeenCalledWith("interview.reaction");
  });
  it("질문 음성 중 반응을 적용하지 않고 채팅의 중단 메시지도 폐기한다", async () => {
    const { result, room, receive } = await joined(true);
    await receive(
      message({ interrupt: { reason: "OFF_TOPIC", text: "질문에 맞게 답변해 주세요." } }),
    );
    expect(result.current.reaction).toBeNull();
    await act(async () => {
      await room.rpcHandlers.get("interview.question")!({
        callerIdentity: "agent",
        payload: JSON.stringify({
          type: "question",
          sessionId: 55,
          seq: 3,
          content: "질문",
          speech: "started",
          alignment: null,
        }),
      });
    });
    await receive();
    expect(result.current.reaction).toBeNull();
  });
});

describe("채팅 입력 신호 전송", () => {
  async function joined() {
    const hook = renderHook(() => useInterviewRoom(55, null, { listenOnly: true }));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    return { ...hook, room };
  }

  it("입력 전체와 질문·입력 순서·쉰 시간을 기존 연결의 에이전트에 전송한다", async () => {
    const { result, room } = await joined();
    await result.current.sendChatInput(3, 2, "작성 중인 답변", 820);
    expect(room.localParticipant.performRpc).toHaveBeenCalledExactlyOnceWith({
      destinationIdentity: "agent",
      method: "interview.chatInput",
      payload: JSON.stringify({
        type: "chat.input",
        sessionId: 55,
        questionSeq: 3,
        seq: 2,
        text: "작성 중인 답변",
        pauseMs: 820,
      }),
    });
    expect(sdk.FakeRoom.instances).toHaveLength(1);
  });

  it("응답 본문을 사용하지 않으며 전송 오류도 전파하지 않는다", async () => {
    const { result, room } = await joined();
    room.localParticipant.performRpc.mockResolvedValueOnce("not json");
    await expect(result.current.sendChatInput(3, 1, "답", 800)).resolves.toBeUndefined();
    room.localParticipant.performRpc.mockRejectedValueOnce(new Error("no handler"));
    await expect(result.current.sendChatInput(3, 2, "", 800)).resolves.toBeUndefined();
  });

  it("에이전트가 없거나 화면 정리 후에는 전송하지 않는다", async () => {
    const { result, room, unmount } = await joined();
    room.remoteParticipants.delete("agent");
    await result.current.sendChatInput(3, 1, "답", 800);
    unmount();
    await result.current.sendChatInput(3, 2, "답변", 800);
    expect(room.localParticipant.performRpc).not.toHaveBeenCalled();
  });
});

describe("질문 메시지 수신", () => {
  const message = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "question",
      sessionId: 55,
      seq: 1,
      content: "경험을 설명해 주세요.",
      speech: "started",
      alignment: null,
      ...overrides,
    });

  async function joined() {
    const hook = renderHook(() => useInterviewRoom(55, null, { listenOnly: true }));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    const handler = room.rpcHandlers.get("interview.question")!;
    const receive = (payload = message(), callerIdentity = "agent") =>
      act(async () => {
        expect(await handler({ callerIdentity, payload })).toBe("");
      });
    return { ...hook, room, receive };
  }

  it("질문 시작과 종료를 반영하고 이전 순서와 종료 뒤 시작 메시지는 폐기한다", async () => {
    const { result, receive } = await joined();
    await receive(message({ seq: 2 }));
    expect(result.current.question?.speech).toBe("started");
    await receive(message({ seq: 2, speech: "ended" }));
    await receive(message({ seq: 2 }));
    await receive(message({ seq: 1 }));
    expect(result.current.question).toMatchObject({ seq: 2, speech: "ended" });
    await receive(message({ seq: 3, speech: "failed" }));
    expect(result.current.question).toMatchObject({ seq: 3, speech: "failed" });
  });

  it("다른 참가자와 면접 및 잘못된 본문을 반영하지 않는다", async () => {
    const { result, receive } = await joined();
    await receive(message(), "other");
    await receive(message({ sessionId: 56 }));
    await receive(message({ seq: true }));
    await receive(message({ speech: "unknown" }));
    await receive("not json");
    expect(result.current.question).toBeNull();
  });

  it("질문 발음 시각을 유지하고 정리 이후 메시지는 폐기한다", async () => {
    const { result, room, receive, unmount } = await joined();
    const alignment = { chars: [{ char: "가", startMs: 0, endMs: 100 }] };
    await receive(message({ alignment }));
    expect(result.current.question?.alignment).toEqual(alignment);
    unmount();
    expect(room.unregisterRpcMethod).toHaveBeenCalledWith("interview.question");
    await receive(message({ seq: 5 }));
    expect(result.current.question?.seq).toBe(1);
  });
});

describe("면접방 마이크 송출과 STT 수신", () => {
  it("장치 스트림이 없으면 입장 API와 RTC를 실행하지 않는다", () => {
    renderHook(() => useInterviewRoom(55, null));
    expect(sdk.issueRoomToken).not.toHaveBeenCalled();
    expect(sdk.FakeRoom.instances).toHaveLength(0);
  });

  it("기존 마이크를 송출하고 원본 장치의 소유권을 유지한다", async () => {
    const { stream, microphone } = media();
    const { unmount } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() =>
      expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(microphone, {
        source: "microphone",
      }),
    );
    expect(sdk.issueRoomToken).toHaveBeenCalledWith(55);
    expect(room.connect).toHaveBeenCalledWith("wss://room.test", "room-token");
    expect(room.options).toEqual({ stopLocalTrackOnUnpublish: false });
    expect(room.registerTextStreamHandler.mock.calls[0][0]).toBe(STT_TOPIC);
    expect(room.registerTextStreamHandler.mock.invocationCallOrder[0]).toBeLessThan(
      room.localParticipant.publishTrack.mock.invocationCallOrder[0],
    );
    unmount();
    expect(room.disconnect).toHaveBeenCalledWith(false);
    expect(room.unregisterTextStreamHandler).toHaveBeenCalledWith(STT_TOPIC);
    expect(microphone.stop).not.toHaveBeenCalled();
  });

  it("중간 결과를 교체하고 확정 결과를 중복 없이 표시하며 늦은 갱신은 버린다", async () => {
    const { stream } = media();
    const { result, rerender } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalled());
    await deliver(room, snapshot(1));
    expect(result.current.confirmedText + result.current.interimText).toBe("안녕하세요 저는");
    await deliver(
      room,
      snapshot(3, { confirmedText: "안녕하세요 저는 개발자입니다.", interimText: "" }),
    );
    await deliver(room, snapshot(2));
    expect(result.current.confirmedText).toBe("안녕하세요 저는 개발자입니다.");
    expect(result.current.interimText).toBe("");
    rerender();
    expect(sdk.FakeRoom.instances).toHaveLength(1);
  });

  it("에이전트 외 참가자나 잘못된 메시지를 답변으로 표시하지 않는다", async () => {
    const { stream } = media();
    const { result } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    await deliver(room, snapshot(1), "other");
    await deliver(room, { confirmedText: "잘못된 형식" });
    expect(result.current.confirmedText).toBe("");
  });

  it("이전 캡처가 늦게 도착해도 새 캡처를 덮어쓰지 않는다", async () => {
    const { stream } = media();
    const { result } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    await deliver(room, snapshot(4));
    await deliver(
      room,
      snapshot(1, { streamId: "capture-2", confirmedText: "새 답변", interimText: "" }),
    );
    await deliver(room, snapshot(5));
    expect(result.current.confirmedText).toBe("새 답변");
  });

  it("SDK 재접속 성공 시 침묵 중에도 이전 인식 상태와 텍스트를 복원한다", async () => {
    const { stream } = media();
    const { result } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    await deliver(room, snapshot(1));
    act(() => room.handlers.get("reconnecting")?.());
    expect(result.current.status).toBe("reconnecting");
    act(() => room.handlers.get("reconnected")?.());
    expect(result.current.status).toBe("listening");
    expect(result.current.confirmedText).toBe("안녕하세요");
  });

  it("STT 실패 메시지에서도 마지막 텍스트를 보존한다", async () => {
    const { stream } = media();
    const { result } = renderHook(() => useInterviewRoom(55, stream));
    await deliver(sdk.FakeRoom.instances[0], snapshot(2, { state: "failed" }));
    expect(result.current.status).toBe("sttFailed");
    expect(result.current.confirmedText).toBe("안녕하세요");
  });

  it("입장 실패 뒤 다시 연결하면 새 토큰을 요청한다", async () => {
    sdk.issueRoomToken.mockResolvedValue({ ok: false, code: "INVALID_SESSION_STATE", status: 409 });
    const { stream } = media();
    const { result } = renderHook(() => useInterviewRoom(55, stream));
    await waitFor(() => expect(result.current.status).toBe("failed"));
    sdk.issueRoomToken.mockResolvedValue({ ok: true, url: "wss://room.test", token: "fresh" });
    act(() => result.current.retry());
    await waitFor(() =>
      expect(sdk.FakeRoom.instances[1].connect).toHaveBeenCalledWith("wss://room.test", "fresh"),
    );
  });

  it("입장 요청 중 화면을 떠나면 늦게 받은 토큰으로 연결하지 않는다", async () => {
    let resolve!: (access: unknown) => void;
    sdk.issueRoomToken.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { stream } = media();
    const { unmount } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    unmount();
    await act(async () => resolve({ ok: true, url: "wss://room.test", token: "late" }));
    expect(room.connect).not.toHaveBeenCalled();
  });

  it("면접관(에이전트) 음성만 재생하고, 구독이 끝나거나 화면을 떠나면 재생 요소를 지운다", async () => {
    const { stream } = media();
    const { unmount } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    const subscribed = room.handlers.get("trackSubscribed")!;
    const unsubscribed = room.handlers.get("trackUnsubscribed")!;
    const voice = (element: HTMLAudioElement) => ({
      kind: "audio",
      attach: vi.fn(() => element),
      detach: vi.fn(() => [element]),
    });
    const first = document.createElement("audio");
    const second = document.createElement("audio");
    const ignored = voice(document.createElement("audio"));
    subscribed(voice(first), {}, { isAgent: true });
    subscribed(ignored, {}, { isAgent: false });
    subscribed({ kind: "video", attach: vi.fn() }, {}, { isAgent: true });
    const secondTrack = voice(second);
    subscribed(secondTrack, {}, { isAgent: true });
    expect(ignored.attach).not.toHaveBeenCalled();
    expect(first.isConnected && first.hidden).toBe(true);
    unsubscribed(secondTrack);
    expect(second.isConnected).toBe(false);
    unmount();
    expect(first.isConnected).toBe(false);
  });
});

describe("채팅 면접방(송출 없이 수신)", () => {
  it("마이크 없이 들어가 송출하지 않고, 스트림이 있어도 송출하지 않는다", async () => {
    const { stream, microphone } = media();
    const { result, unmount } = renderHook(() =>
      useInterviewRoom(55, stream, { listenOnly: true }),
    );
    const room = sdk.FakeRoom.instances[0];
    // 듣는 중은 송출할지 정한 뒤에 바뀌므로, 이때 송출이 없으면 끝까지 없다(채팅에는 STT 메시지가 오지 않는다).
    await waitFor(() => expect(result.current.status).toBe("listening"));
    expect(room.connect).toHaveBeenCalledWith("wss://room.test", "room-token");
    expect(sdk.issueRoomToken).toHaveBeenCalledWith(55);
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    // 넘겨받은 마이크가 끊겨도 채팅은 마이크를 쓰지 않으므로 상관없다.
    act(() => microphone.dispatchEvent(new Event("ended")));
    expect(result.current.status).toBe("listening");
    // SDK가 끊긴 연결을 다시 이으면 듣는 중으로 돌아온다.
    act(() => room.handlers.get("reconnecting")?.());
    expect(result.current.status).toBe("reconnecting");
    act(() => room.handlers.get("reconnected")?.());
    expect(result.current.status).toBe("listening");
    unmount();
    expect(room.disconnect).toHaveBeenCalledWith(false);
  });

  it("다시 그려도(옵션 객체가 새로 만들어져도) 다시 들어가지 않는다", async () => {
    const { result, rerender } = renderHook(() => useInterviewRoom(55, null, { listenOnly: true }));
    await waitFor(() => expect(result.current.status).toBe("listening"));
    rerender();
    rerender();
    expect(sdk.FakeRoom.instances).toHaveLength(1);
    expect(sdk.issueRoomToken).toHaveBeenCalledTimes(1);
  });

  it("면접관(에이전트) 음성을 재생한다", async () => {
    const { unmount } = renderHook(() => useInterviewRoom(55, null, { listenOnly: true }));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.connect).toHaveBeenCalled());
    const element = document.createElement("audio");
    room.handlers.get("trackSubscribed")!(
      { kind: "audio", attach: vi.fn(() => element), detach: vi.fn(() => [element]) },
      {},
      { isAgent: true },
    );
    expect(element.isConnected && element.hidden).toBe(true);
    unmount();
    expect(element.isConnected).toBe(false);
  });

  it("입장 토큰을 받지 못하면 연결하지 않는다", async () => {
    sdk.issueRoomToken.mockResolvedValue({ ok: false, code: "INVALID_SESSION_STATE", status: 409 });
    const { result } = renderHook(() => useInterviewRoom(55, null, { listenOnly: true }));
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(sdk.FakeRoom.instances[0].connect).not.toHaveBeenCalled();
  });
});

describe("답변 상태(answer.state) 받기 · [답변 완료](answer.submit) 보내기", () => {
  const message = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "answer.state",
      sessionId: 55,
      seq: 2,
      state: "submitted",
      ...overrides,
    });

  async function joined(onAnswerState = vi.fn()) {
    const { stream } = media();
    const hook = renderHook(() => useInterviewRoom(55, stream, { onAnswerState }));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalled());
    const deliverState = (payload: string, caller = "agent") =>
      act(async () => {
        expect(
          await room.rpcHandlers.get("interview.answerState")!({ callerIdentity: caller, payload }),
        ).toBe("");
      });
    return { ...hook, room, onAnswerState, deliverState };
  }

  it("에이전트가 보낸 이 면접의 답변 상태만 넘기고, 화면을 떠나면 받지 않는다", async () => {
    const { room, onAnswerState, deliverState, unmount } = await joined();

    await deliverState(message());
    expect(onAnswerState).toHaveBeenCalledExactlyOnceWith({
      type: "answer.state",
      sessionId: 55,
      seq: 2,
      state: "submitted",
    });

    // 에이전트가 아닌 참가자 · 다른 면접 · 형식이 틀린 메시지는 버린다
    await deliverState(message(), "other");
    await deliverState(message({ sessionId: 56 }));
    await deliverState(message({ state: "done" }));
    await deliverState("not json");
    expect(onAnswerState).toHaveBeenCalledTimes(1);

    const handler = room.rpcHandlers.get("interview.answerState")!;
    unmount();
    expect(room.unregisterRpcMethod).toHaveBeenCalledWith("interview.answerState");
    // 정리 중에 늦게 도착한 메시지도 넘기지 않는다
    await act(async () => {
      await handler({ callerIdentity: "agent", payload: message() });
    });
    expect(onAnswerState).toHaveBeenCalledTimes(1);
  });

  it("넘기는 함수가 바뀌어도 다시 입장하지 않고 최신 함수로 넘긴다", async () => {
    const { stream } = media();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }) => useInterviewRoom(55, stream, { onAnswerState: handler }),
      {
        initialProps: { handler: first },
      },
    );
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalled());
    rerender({ handler: second });

    await act(async () => {
      await room.rpcHandlers.get("interview.answerState")!({
        callerIdentity: "agent",
        payload: message(),
      });
    });
    expect(sdk.FakeRoom.instances).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("[답변 완료]를 에이전트에 보내고, 받으면 accepted", async () => {
    const { result, room } = await joined();

    expect(await result.current.submitAnswer(2)).toBe("accepted");
    expect(room.localParticipant.performRpc).toHaveBeenCalledExactlyOnceWith({
      destinationIdentity: "agent",
      method: "interview.answerSubmit",
      payload: JSON.stringify({ type: "answer.submit", sessionId: 55, seq: 2 }),
    });
  });

  it("에이전트가 받지 않거나(accepted false · 2001 · 2002) 거절하면 rejected, 그 밖의 실패는 failed", async () => {
    const { result, room } = await joined();
    const rpc = room.localParticipant.performRpc;

    rpc.mockResolvedValueOnce(JSON.stringify({ accepted: false }));
    expect(await result.current.submitAnswer(2)).toBe("rejected");
    // 응답 형식이 틀리면 다시 보내도 같으므로 받지 않은 것으로 본다
    rpc.mockResolvedValueOnce("not json");
    expect(await result.current.submitAnswer(2)).toBe("rejected");
    rpc.mockResolvedValueOnce("{}");
    expect(await result.current.submitAnswer(2)).toBe("rejected");
    rpc.mockRejectedValueOnce(new sdk.RpcError(2001, "EMPTY_ANSWER"));
    expect(await result.current.submitAnswer(2)).toBe("rejected");
    rpc.mockRejectedValueOnce(new sdk.RpcError(2002, "NOT_ANSWERING"));
    expect(await result.current.submitAnswer(2)).toBe("rejected");
    rpc.mockRejectedValueOnce(new sdk.RpcError(1500, "Response timeout"));
    expect(await result.current.submitAnswer(2)).toBe("failed");
    rpc.mockRejectedValueOnce(new Error("disconnected"));
    expect(await result.current.submitAnswer(2)).toBe("failed");
  });

  it("면접방에 들어가기 전이거나 에이전트가 없으면 보내지 못한다(failed)", async () => {
    sdk.issueRoomToken.mockReturnValue(new Promise(() => {}));
    const { stream } = media();
    const before = renderHook(() => useInterviewRoom(55, stream));
    expect(await before.result.current.submitAnswer(1)).toBe("failed");
    before.unmount();

    sdk.issueRoomToken.mockResolvedValue({ ok: true, url: "wss://room.test", token: "t" });
    const { result } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[1];
    await waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalled());
    room.remoteParticipants.delete("agent");
    expect(await result.current.submitAnswer(1)).toBe("failed");
    expect(room.localParticipant.performRpc).not.toHaveBeenCalled();
  });

  it("STT 캡처가 바뀌면(답변마다 새 캡처) 그 캡처 id를 알려 준다", async () => {
    const { result, room } = await joined();
    await deliver(room, snapshot(1));
    expect(result.current.streamId).toBe("capture-1");
    await deliver(room, snapshot(1, { streamId: "capture-2", confirmedText: "", interimText: "" }));
    expect(result.current.streamId).toBe("capture-2");
  });
});

// 기준: API 명세 녹화(화면은 카메라 영상을 H.264로 송출한다) · AI 명세 7장
// · 사용자 결정(2026-10-27: 카메라 송출이 실패해도 면접은 표시 없이 계속)
describe("녹화용 카메라 송출", () => {
  it("화상은 마이크 다음에 카메라를 H.264 · 화질 단계 없이 올리고, 원본 카메라는 끄지 않는다", async () => {
    const { stream, microphone, camera } = media({ withCamera: true });
    const { unmount } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2));
    expect(room.localParticipant.publishTrack.mock.calls).toEqual([
      [microphone, { source: "microphone" }],
      [camera, { source: "camera", videoCodec: "h264", simulcast: false }],
    ]);
    unmount();
    expect(camera.stop).not.toHaveBeenCalled();
  });

  it("카메라가 없으면 마이크만 올린다", async () => {
    const { stream, microphone } = media();
    renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalled());
    await act(async () => {});
    expect(room.localParticipant.publishTrack.mock.calls).toEqual([
      [microphone, { source: "microphone" }],
    ]);
  });

  it("카메라를 올리다 실패해도 면접방 연결은 실패로 보지 않는다", async () => {
    const { stream } = media({ withCamera: true });
    const { result } = renderHook(() => useInterviewRoom(55, stream));
    const room = sdk.FakeRoom.instances[0];
    room.localParticipant.publishTrack.mockImplementation(async (track: unknown) => {
      if (track !== stream.getAudioTracks()[0]) throw new Error("H.264 송출 실패");
    });
    await waitFor(() => expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(result.current.status).not.toBe("failed");
    expect(room.disconnect).not.toHaveBeenCalled();
  });

  it("채팅(listenOnly)은 스트림에 카메라가 있어도 올리지 않는다", async () => {
    const { stream } = media({ withCamera: true });
    const { result } = renderHook(() => useInterviewRoom(55, stream, { listenOnly: true }));
    const room = sdk.FakeRoom.instances[0];
    await waitFor(() => expect(result.current.status).toBe("listening"));
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });
});
