import { AudioUnavailableError, type AudioSource, type AudioSourceHandlers } from "@soniox/client";

import { mediaFailure, type DeviceFailure } from "@/lib/devices/media";
import type { AnswerAudioContentType } from "@/types/api";

// 기준: Swagger 5.6 답변 음성 업로드 주소(AnswerAudioUploadUrlRequest.contentType) · API 명세 5.7(tokens 시각은 답변 음성 파일 시작 기준,
// "음성 인식이 수신한 첫 음성의 시작 − 파일 시작"을 연결마다 더한다) · @soniox/client 2.4.0 AudioSource(start · stop · restart)
// · 지원 브라우저 Chrome/Edge(docs/CONTRIBUTING.md:311)
// 마이크 스트림 하나에서 녹음기 둘을 실행한다. 파일 녹음기는 답변 음성 파일(5.6 업로드)을, 음성 인식 녹음기는 Soniox로 전송할 조각을 생성한다.

/** 녹음 형식. Chrome/Edge가 지원하는 webm/opus만 사용한다 */
const MIME_TYPE = "audio/webm;codecs=opus";

/** 음성 인식 조각 간격(밀리초). SDK 기본값은 60ms. 재확인 대상 */
const STT_TIMESLICE_MS = 100;

/** 마이크를 직접 열 때 제약. SDK MicrophoneSource 기본값과 같다 */
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: 16000,
};

export type AnswerCaptureStartResult =
  | {
      ok: true;
      /** 파일 녹음기 start 이벤트 시각(performance.now). tokens 시각의 기준 */
      fileStartedAt: number;
      /** 5.6에 전송할 녹음 형식(recorder.mimeType의 ";" 앞) */
      contentType: AnswerAudioContentType;
    }
  | { ok: false; reason: DeviceFailure };

export interface AnswerCapture {
  /**
   * 답변 녹음을 시작한다. 화상 화면이 이미 연 stream을 전달하면 그 오디오 트랙을 복제해 사용하고, 없으면 마이크를 직접 연다.
   * 파일 녹음기가 시작된 뒤에 resolve된다. 앞서 시작한 녹음이 있으면 먼저 해제한다.
   */
  start(stream?: MediaStream): Promise<AnswerCaptureStartResult>;
  /** 파일 녹음기를 중지하고 답변 음성 파일을 반환한다. 녹음 중이 아니면 null */
  stopFile(): Promise<Blob | null>;
  /** Soniox SDK record()의 source로 전달할 음성 인식 소스. 파일 녹음과 같은 스트림을 사용한다 */
  createSttSource(): AudioSource;
  /** 현재 음성 인식 녹음기의 start 이벤트 시각(performance.now). 연결 · 재연결마다 새로 기록한다 */
  getSttStartedAt(): number | null;
  /** 녹음기 둘을 중지하고 이 모듈이 연 트랙(복제 트랙 포함)을 모두 해제한다. 전달받은 원본 트랙은 중지하지 않는다 */
  dispose(): void;
}

interface SttRecorder {
  recorder: MediaRecorder;
  onData: (event: BlobEvent) => void;
  onError: () => void;
  /** restart로 폐기한 녹음기. 이미 생성된 조각도 새 연결로 전송하지 않는다 */
  discarded: boolean;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** 녹음기 start 이벤트를 기다려 그 시각을 반환한다 */
function startRecorder(recorder: MediaRecorder, timeslice?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    recorder.addEventListener("start", () => resolve(performance.now()), { once: true });
    recorder.addEventListener("error", (event) => reject(event), { once: true });
    recorder.start(timeslice);
  });
}

export function createAnswerCapture(): AnswerCapture {
  /** 이 모듈이 연 스트림. 직접 연 것이든 복제 트랙으로 생성한 것이든 dispose에서 모든 트랙을 중지한다 */
  let stream: MediaStream | null = null;
  let fileRecorder: MediaRecorder | null = null;
  let fileChunks: Blob[] = [];
  let stt: SttRecorder | null = null;
  let handlers: AudioSourceHandlers | null = null;
  let sttStartedAt: number | null = null;
  /** 마지막으로 start한 음성 인식 소스 표시 */
  let sttOwner: object | null = null;
  /** start 도중 dispose · 다시 start되면 뒤늦게 열린 스트림을 폐기하기 위한 번호 */
  let generation = 0;

  function detach(target: SttRecorder) {
    target.recorder.removeEventListener("dataavailable", target.onData);
    target.recorder.removeEventListener("error", target.onError);
  }

  function startStt() {
    if (!stream || !handlers) return;
    const current = handlers;
    const recorder = new MediaRecorder(stream, { mimeType: MIME_TYPE });
    const target: SttRecorder = {
      recorder,
      discarded: false,
      onData: (event) => {
        if (event.data.size === 0) return;
        event.data.arrayBuffer().then(
          (buffer) => {
            if (!target.discarded) current.onData(buffer);
          },
          (error: unknown) => current.onError(toError(error)),
        );
      },
      onError: () => current.onError(new Error("MediaRecorder error")),
    };
    recorder.addEventListener("dataavailable", target.onData);
    recorder.addEventListener("error", target.onError);
    recorder.addEventListener(
      "start",
      () => {
        if (stt === target) sttStartedAt = performance.now();
      },
      { once: true },
    );
    // 새 녹음기의 start 이벤트 전에는 앞 녹음기 시각으로 offset을 계산하지 않도록 초기화한다.
    sttStartedAt = null;
    stt = target;
    recorder.start(STT_TIMESLICE_MS);
  }

  /**
   * 음성 인식 녹음기만 중지한다. 처리기는 stop 이벤트 뒤에 해제해 마지막 조각까지 SDK에 전달한다.
   * SDK는 source.stop() 직후 세션을 finishing으로 전환해 이후 전달된 조각은 전송하지 않는다(SDK MicrophoneSource와 같다).
   */
  function stopStt() {
    const target = stt;
    if (!target || target.recorder.state === "inactive") return;
    target.recorder.addEventListener("stop", () => detach(target), { once: true });
    target.recorder.stop();
  }

  /** 이전 처리기 제거 → 중지 → 새 녹음기 시작. 새 연결이 새 컨테이너 헤더부터 수신하게 한다 */
  function replaceStt() {
    if (!stream || !handlers) return;
    const previous = stt;
    if (previous) {
      previous.discarded = true;
      detach(previous);
      if (previous.recorder.state !== "inactive") previous.recorder.stop();
    }
    startStt();
  }

  /**
   * record()마다 새 소스를 생성한다. 마지막으로 start한 소스만 녹음기를 제어한다.
   * 폐기한 앞 녹음의 SDK가 5.10 · 연결을 기다린 뒤 뒤늦게 호출하는 stop()이 새 녹음기를 중지하지 않게 한다.
   */
  function createSttSource(): AudioSource {
    const owner = {};
    return {
      async start(next) {
        // 파일 녹음(start)이 먼저 마이크를 열어야 한다. SDK는 start에서 throw한 오류를 error 이벤트로 전달한다.
        if (!stream) throw new AudioUnavailableError("answer capture is not started");
        sttOwner = owner;
        handlers = next;
        replaceStt();
      },
      // 처리기와 스트림은 유지한다. SDK는 첫 연결 실패 때 stop() 뒤 restart()를 호출한다.
      stop() {
        if (sttOwner === owner) stopStt();
      },
      restart() {
        if (sttOwner === owner) replaceStt();
      },
    };
  }

  function dispose() {
    generation++;
    sttOwner = null;
    if (stt) {
      stt.discarded = true;
      detach(stt);
      if (stt.recorder.state !== "inactive") stt.recorder.stop();
      stt = null;
    }
    if (fileRecorder && fileRecorder.state !== "inactive") fileRecorder.stop();
    fileRecorder = null;
    fileChunks = [];
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    handlers = null;
    sttStartedAt = null;
  }

  async function start(source?: MediaStream): Promise<AnswerCaptureStartResult> {
    dispose();
    const mine = generation;
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported(MIME_TYPE)) {
      return { ok: false, reason: "unsupported" };
    }

    let opened: MediaStream;
    try {
      if (source) {
        // 화상 화면의 원본 트랙은 화면이 관리한다. 복제 트랙만 이 모듈이 중지한다.
        const tracks = source.getAudioTracks();
        if (tracks.length === 0) return { ok: false, reason: "missing" };
        opened = new MediaStream(tracks.map((track) => track.clone()));
      } else {
        if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "unsupported" };
        opened = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      }
    } catch (error) {
      return { ok: false, reason: mediaFailure(error) };
    }
    if (mine !== generation) {
      opened.getTracks().forEach((track) => track.stop());
      return { ok: false, reason: "ended" };
    }
    stream = opened;

    try {
      const recorder = new MediaRecorder(opened, { mimeType: MIME_TYPE });
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) fileChunks.push(event.data);
      });
      fileRecorder = recorder;
      const fileStartedAt = await startRecorder(recorder);
      // MIME_TYPE(webm)으로 생성했으므로 ";" 앞은 5.6 허용값 audio/webm이다.
      const contentType = (recorder.mimeType || MIME_TYPE).split(";")[0] as AnswerAudioContentType;
      return { ok: true, fileStartedAt, contentType };
    } catch (error) {
      dispose();
      return { ok: false, reason: mediaFailure(error) };
    }
  }

  function stopFile(): Promise<Blob | null> {
    const recorder = fileRecorder;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.addEventListener(
        "stop",
        () => resolve(new Blob(fileChunks, { type: recorder.mimeType || MIME_TYPE })),
        { once: true },
      );
      recorder.stop();
    });
  }

  return {
    start,
    stopFile,
    createSttSource,
    getSttStartedAt: () => sttStartedAt,
    dispose,
  };
}
