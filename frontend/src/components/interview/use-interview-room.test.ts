import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STT_TOPIC } from "@/lib/interview/transcript";

import { useInterviewRoom } from "./use-interview-room";

// 기준: 웹 Swagger 5.14 · 승인된 STT 스냅샷 계약. API와 RTC 경계만 대체한다.
const sdk = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class FakeRoom {
    static instances: FakeRoom[] = [];
    handlers = new Map<string, Handler>();
    textHandler?: (
      reader: { readAll: () => Promise<string> },
      sender: { identity: string },
    ) => void;
    remoteParticipants = new Map([
      ["agent", { isAgent: true }],
      ["other", { isAgent: false }],
    ]);
    localParticipant = {
      publishTrack: vi.fn(async () => {}),
      unpublishTrack: vi.fn(async () => {}),
    };
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
  return { FakeRoom, issueRoomToken: vi.fn() };
});

vi.mock("livekit-client", () => ({
  Room: sdk.FakeRoom,
  RoomEvent: {
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
  },
  Track: { Source: { Microphone: "microphone" }, Kind: { Audio: "audio", Video: "video" } },
}));
vi.mock("@/lib/interview/actions", () => ({ issueRoomToken: sdk.issueRoomToken }));

function media() {
  const microphone = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn() });
  const stream = { getAudioTracks: () => [microphone] } as unknown as MediaStream;
  return { stream, microphone };
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
