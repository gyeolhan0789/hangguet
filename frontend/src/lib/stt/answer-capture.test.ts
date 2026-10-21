import type { AudioSourceHandlers } from "@soniox/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnswerCapture } from "./answer-capture";

// jsdom에는 MediaRecorder · MediaStream · getUserMedia가 없어 테스트 대역으로 대체한다.
// 테스트 대역 녹음기는 브라우저처럼 start · stop 이벤트를 비동기로 전송하고, stop 때 마지막 조각(dataavailable)을 먼저 전송한다.

class FakeTrack {
  readonly kind = "audio";
  stop = vi.fn();
  clone = vi.fn(() => {
    const copy = new FakeTrack();
    clones.push(copy);
    return copy;
  });
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = vi.fn(() => true);
  static instances: FakeMediaRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  readonly mimeType: string;
  timeslice: number | undefined;

  constructor(
    readonly stream: FakeMediaStream,
    options: { mimeType: string },
  ) {
    super();
    this.mimeType = options.mimeType;
    FakeMediaRecorder.instances.push(this);
  }

  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
    queueMicrotask(() => this.dispatchEvent(new Event("start")));
  }

  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.emit("last");
      this.dispatchEvent(new Event("stop"));
    });
  }

  /** 조각 하나를 발생시킨다 */
  emit(text: string) {
    this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob([text]) }));
  }
}

let clones: FakeTrack[] = [];
const getUserMedia = vi.fn();
let now = 0;

/** 녹음기 이벤트와 Blob.arrayBuffer가 완료될 때까지 기다린다 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const recorders = () => FakeMediaRecorder.instances;
const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

function micStream() {
  const track = new FakeTrack();
  getUserMedia.mockResolvedValueOnce(new FakeMediaStream([track]));
  return track;
}

function handlers() {
  const received: string[] = [];
  const value: AudioSourceHandlers = {
    onData: (chunk) => received.push(decode(chunk)),
    onError: vi.fn(),
  };
  return { value, received };
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported.mockReturnValue(true);
  clones = [];
  getUserMedia.mockReset();
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("MediaStream", FakeMediaStream);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createAnswerCapture start (답변 파일 녹음)", () => {
  it("마이크를 SDK 기본 제약으로 한 번 열고, 파일 녹음기를 먼저 시작해 그 시각과 5.6 contentType을 반환한다", async () => {
    micStream();
    const capture = createAnswerCapture();
    now = 120;

    const result = await capture.start();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 16000,
      },
    });
    // 음성 인식 녹음기는 아직 없다: 파일 녹음기가 먼저다.
    expect(recorders()).toHaveLength(1);
    expect(recorders()[0].state).toBe("recording");
    // mimeType "audio/webm;codecs=opus"의 ";" 앞만 5.6에 전송한다.
    expect(result).toEqual({ ok: true, fileStartedAt: 120, contentType: "audio/webm" });
  });

  it("webm/opus를 녹음할 수 없는 브라우저면 마이크를 열지 않고 unsupported", async () => {
    FakeMediaRecorder.isTypeSupported.mockReturnValue(false);

    expect(await createAnswerCapture().start()).toEqual({ ok: false, reason: "unsupported" });
    expect(FakeMediaRecorder.isTypeSupported).toHaveBeenCalledWith("audio/webm;codecs=opus");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("마이크 권한을 거부하면 denied", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

    expect(await createAnswerCapture().start()).toEqual({ ok: false, reason: "denied" });
    expect(recorders()).toHaveLength(0);
  });

  it("화상 화면이 전달한 스트림이면 마이크를 다시 열지 않고 오디오 트랙을 복제해 사용한다", async () => {
    const original = new FakeTrack();
    const capture = createAnswerCapture();

    const result = await capture.start(new FakeMediaStream([original]) as unknown as MediaStream);

    expect(result.ok).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(original.clone).toHaveBeenCalledTimes(1);
    expect(recorders()[0].stream.getTracks()).toEqual([clones[0]]);
  });

  it("stopFile은 파일 녹음기를 중지하고 답변 음성 Blob을 반환한다", async () => {
    micStream();
    const capture = createAnswerCapture();
    await capture.start();

    const blob = await capture.stopFile();

    expect(blob?.type).toBe("audio/webm;codecs=opus");
    expect(await blob?.text()).toBe("last");
    expect(await capture.stopFile()).toBeNull();
  });
});

describe("createSttSource (SDK AudioSource)", () => {
  async function started() {
    micStream();
    const capture = createAnswerCapture();
    await capture.start();
    const source = capture.createSttSource();
    const sink = handlers();
    now = 200;
    await source.start(sink.value);
    await settle();
    return { capture, source, sink, file: recorders()[0], stt: recorders()[1] };
  }

  it("start는 같은 스트림으로 음성 인식 녹음기를 0.1초 간격으로 시작하고 그 시각을 기록한다", async () => {
    const { capture, sink, file, stt } = await started();

    expect(stt.stream).toBe(file.stream);
    expect(stt.timeslice).toBe(100);
    expect(capture.getSttStartedAt()).toBe(200);

    stt.emit("a");
    await settle();
    expect(sink.received).toEqual(["a"]);
  });

  it("stop은 음성 인식 녹음기만 중지하고 파일 녹음은 계속한다. 마지막 조각까지 처리기에 전달한다", async () => {
    const { source, sink, file, stt } = await started();

    source.stop();
    source.stop(); // 여러 번 불러도 안전하다
    await settle();

    expect(stt.state).toBe("inactive");
    expect(file.state).toBe("recording");
    expect(sink.received).toEqual(["last"]);
  });

  it("restart는 새 녹음기를 시작하고 시작 시각을 새로 기록한다", async () => {
    const { capture, source, stt } = await started();
    now = 900;

    source.restart?.();
    await settle();

    expect(stt.state).toBe("inactive");
    expect(recorders()).toHaveLength(3);
    expect(recorders()[2].state).toBe("recording");
    expect(capture.getSttStartedAt()).toBe(900);
  });

  it("restart 직후 새 녹음기가 시작되기 전에는 앞 녹음기 시작 시각을 반환하지 않는다", async () => {
    const { capture, source } = await started();
    expect(capture.getSttStartedAt()).toBe(200);

    source.restart?.();

    expect(capture.getSttStartedAt()).toBeNull();
  });

  it("stop 뒤 restart면(SDK 첫 연결 실패 뒤 재연결) 새 녹음기의 조각이 다시 전달된다", async () => {
    const { source, sink } = await started();

    source.stop();
    source.restart?.();
    await settle();
    recorders()[2].emit("b");
    await settle();

    expect(sink.received).toEqual(["b"]);
  });

  it("stop 시점에 생성된 조각은 restart 뒤 새 연결로 전송하지 않는다", async () => {
    const { source, sink, stt } = await started();
    stt.emit("a");
    await settle();

    source.stop();
    source.restart?.();
    await settle();

    // 앞 녹음기의 마지막 조각("last")은 폐기한다.
    expect(sink.received).toEqual(["a"]);
  });

  it("새 소스로 start하면 앞 녹음기를 폐기하고, 앞 소스의 뒤늦은 stop()은 새 녹음기를 중지하지 않는다", async () => {
    const { capture, source, sink, stt } = await started();
    const next = capture.createSttSource();
    const nextSink = handlers();
    await next.start(nextSink.value);
    await settle();

    // 폐기한 앞 녹음의 SDK가 5.10 · 연결을 기다린 뒤 호출하는 stop()
    source.stop();
    await settle();
    recorders()[2].emit("b");
    await settle();

    expect(stt.state).toBe("inactive");
    expect(recorders()[2].state).toBe("recording");
    expect(nextSink.received).toEqual(["b"]);
    expect(sink.received).toEqual([]);
  });

  it("앞 소스의 뒤늦은 restart()는 새 녹음기에 영향을 주지 않는다", async () => {
    const { capture, source } = await started();
    await capture.createSttSource().start(handlers().value);
    await settle();

    source.restart?.();
    await settle();

    expect(recorders()).toHaveLength(3);
    expect(recorders()[2].state).toBe("recording");
  });

  it("답변 녹음을 시작하기 전에는 시작하지 않고 SDK에 오류를 throw한다", async () => {
    const source = createAnswerCapture().createSttSource();

    await expect(source.start(handlers().value)).rejects.toThrow("answer capture is not started");
  });
});

describe("dispose (마이크 해제)", () => {
  it("녹음기 둘을 중지하고 직접 연 트랙을 모두 중지한다. 여러 번 호출해도 안전하다", async () => {
    const track = micStream();
    const capture = createAnswerCapture();
    await capture.start();
    await capture.createSttSource().start(handlers().value);

    capture.dispose();
    capture.dispose();

    expect(recorders().map((r) => r.state)).toEqual(["inactive", "inactive"]);
    expect(track.stop).toHaveBeenCalled();
    expect(capture.getSttStartedAt()).toBeNull();
  });

  it("복제 트랙은 중지하고 화상 화면의 원본 트랙은 중지하지 않는다", async () => {
    const original = new FakeTrack();
    const capture = createAnswerCapture();
    await capture.start(new FakeMediaStream([original]) as unknown as MediaStream);

    capture.dispose();

    expect(clones[0].stop).toHaveBeenCalled();
    expect(original.stop).not.toHaveBeenCalled();
  });

  it("두 번째 start 전에 앞 스트림을 해제한다", async () => {
    const first = micStream();
    const second = micStream();
    const capture = createAnswerCapture();

    await capture.start();
    await capture.start();

    expect(first.stop).toHaveBeenCalled();
    expect(second.stop).not.toHaveBeenCalled();
    expect(recorders()[0].state).toBe("inactive");
  });
});
