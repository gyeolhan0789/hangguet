"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { issueTtsToken, type TtsTokenActionResult } from "@/lib/interview/actions";
import { QUESTION_VOICE_FAILED } from "@/lib/messages";
import {
  buildTimeline,
  splitDurationByBytes,
  type TimelineChar,
  type TtsAlignment,
} from "@/lib/tts/alignment";
import { buildStreamInputMessages, buildStreamInputUrl } from "@/lib/tts/stream-input";

// 기준: Swagger 5.12 질문 음성 토큰 · API 명세 5.12(질문을 수신한 직후 호출하고 수신한 voiceId · modelId로 연결, 토큰은 연결 1회용,
// 503 · 502 · 504 · 연결 실패 · 끊김이면 질문 글만 보여 주고 계속) · ElevenLabs stream-input 공식 API 문서(응답 audio · alignment,
// isFinal 응답은 audio가 null). 면접관 표현에는 timeline · getPlaybackMs · isSpeaking만 전달한다.
// 브라우저가 ElevenLabs에 직접 연결한다(API 명세 5.12, CONTRIBUTING.md:312 · 367). 토큰은 서버 액션 반환값으로만 수신하고 저장하지 않는다.

/**
 * 연결부터 첫 음성 조각이 도착할 때까지 기다리는 최대 시간(ms). 명세에 없는 임시 FE 값이다.
 * 로컬 실측(2026-10-21)에서 첫 연결의 첫 소리는 3,063ms, 그 뒤는 약 1초였다.
 */
const FIRST_AUDIO_TIMEOUT_MS = 5_000;

/**
 * play()부터 끝 응답(isFinal)까지 기다리는 최대 시간(ms). 5.12 응답 대기와 첫 음성 뒤 끝 응답 대기에도 기한을 설정한다.
 * 그동안 화상 [답변 시작]이 비활성화되므로 무한히 기다리지 않게 한다. 명세에 없는 임시 FE 값이다(실측에서 소리와 끝 응답은 함께 도착했다).
 */
const LOADING_TIMEOUT_MS = 10_000;

/** idle: 재생 전 · 중지, loading: 5.12 · 연결 · 음성 수신 중, playing: 재생 중, ended: 끝까지 재생, failed: 실패(글로 진행) */
export type QuestionTtsStatus = "idle" | "loading" | "playing" | "ended" | "failed";

/**
 * 실패 이유.
 * - token: 5.12 실패(본문 없는 502 · 504, 응답 없음 포함)
 * - connect: WebSocket 연결을 열지 못함(연결 전 오류 · 닫힘)
 * - closedEarly: 연결이 끝(isFinal) 전에 끊김
 * - playback: 수신한 음성을 디코드 · 재생하지 못함(음성 조각 없이 끝난 경우 포함)
 * - timeout: 첫 음성 조각이 FIRST_AUDIO_TIMEOUT_MS 안에 도착하지 않거나, 끝 응답이 LOADING_TIMEOUT_MS 안에 도착하지 않음
 * - blocked: 브라우저 자동재생 정책으로 소리를 낼 수 없음. 사용자가 누른 뒤 replay()하면 수신한 음성으로 다시 재생한다
 */
export type QuestionTtsFailure =
  "token" | "connect" | "closedEarly" | "playback" | "timeout" | "blocked";

export interface QuestionTtsTarget {
  sessionId: number;
  questionId: number;
  /** 읽을 질문 글(5.4 · 5.5 content) */
  content: string;
}

export interface QuestionTts {
  status: QuestionTtsStatus;
  /** status가 failed일 때의 이유. 그 밖에는 null */
  failure: QuestionTtsFailure | null;
  /** status가 failed일 때 보여 줄 문구. 그 밖에는 null */
  failureMessage: string | null;
  /** 현재 재생 중이거나 마지막으로 재생한 질문 음성의 글자별 발음 시각. 질문 음성 맨 앞이 0 */
  timeline: TimelineChar[];
  /** 소리를 재생하는 중인지(status가 playing) */
  isSpeaking: boolean;
  /** 질문 음성 재생 위치(ms, timeline과 같은 기준). 재생 중이 아니면 null. 면접관 표현이 매 프레임 읽는다 */
  getPlaybackMs: () => number | null;
  /** 질문 음성을 처음부터 재생한다. 호출할 때마다 5.12로 새 토큰을 발급받아 바로 연결한다. 앞 재생은 중지한다 */
  play: (target: QuestionTtsTarget) => void;
  /** 마지막 질문을 다시 재생한다. 이 화면에서 끝까지 수신한 질문이면 5.12를 호출하지 않고 수신한 음성을 사용한다 */
  replay: () => void;
  /** 재생을 중지하고 연결을 닫는다(답변 시작 · 질문 전환). 이후 도착하는 5.12 응답 · 음성은 폐기한다 */
  stop: () => void;
}

/** stream-input 응답에서 사용하는 필드. 그 밖의 필드는 읽지 않는다 */
interface StreamOutput {
  audio?: string | null;
  isFinal?: boolean | null;
  alignment?: TtsAlignment | null;
}

interface ReceivedChunk {
  bytes: Uint8Array;
  alignment: TtsAlignment | null;
}

interface CachedVoice {
  buffer: AudioBuffer;
  timeline: TimelineChar[];
}

function parseOutput(data: unknown): StreamOutput | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null ? (parsed as StreamOutput) : null;
  } catch {
    return null;
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(chunks: readonly ReceivedChunk[]): ArrayBuffer {
  const total = chunks.reduce((sum, { bytes }) => sum + bytes.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const { bytes } of chunks) {
    joined.set(bytes, offset);
    offset += bytes.length;
  }
  return joined.buffer;
}

function cacheKey({ sessionId, questionId }: QuestionTtsTarget): string {
  return `${sessionId}/${questionId}`;
}

export function useQuestionTts(): QuestionTts {
  const [status, setStatus] = useState<QuestionTtsStatus>("idle");
  const [failure, setFailure] = useState<QuestionTtsFailure | null>(null);
  const [timeline, setTimeline] = useState<TimelineChar[]>([]);

  /**
   * 재생 세대 번호. play · replay · stop이 증가시키고, 시작할 때의 번호와 다른 5.12 응답 · WebSocket 메시지 · 디코드 결과는 폐기한다.
   * 서버 액션은 클라이언트마다 하나씩 처리돼 5.12가 늦게 완료될 수 있다(Next server-actions.md:28).
   */
  const generation = useRef(0);
  const context = useRef<AudioContext | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const firstAudioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  /** 재생 중인 소리의 시작 시각(AudioContext.currentTime, 초). 재생 중이 아니면 null */
  const startedAt = useRef<number | null>(null);
  const lastTarget = useRef<QuestionTtsTarget | null>(null);
  /** 이 화면에서 끝까지 수신한 질문 음성. 키는 면접 id/질문 id */
  const cache = useRef(new Map<string, CachedVoice>());
  const resumeOnPointer = useRef<(() => void) | null>(null);

  /** AudioContext는 하나만 생성한다. 사용자 동작 전에 생성한 AudioContext는 정지 상태일 수 있으므로 처음 누를 때 재개(resume)한다 */
  const ensureContext = useCallback((): AudioContext => {
    if (context.current) return context.current;
    const created = new AudioContext();
    context.current = created;
    const resume = () => void created.resume();
    resumeOnPointer.current = resume;
    window.addEventListener("pointerdown", resume, { once: true });
    return created;
  }, []);

  /**
   * 연결 · 첫 음성 타이머 · 소리를 정리한다. 상태는 변경하지 않는다.
   * 세대를 변경하는 곳(play · replay · stop · 화면 이탈)과 실패는 모두 이 함수를 호출하므로, 앞 WebSocket · 소리의 처리기는
   * 여기서 해제해 이후 메시지 · 끝 이벤트가 전달되지 않게 한다. 세대 확인은 대기(5.12 · resume · 디코드) 이후에만 수행한다.
   */
  const release = useCallback(() => {
    if (firstAudioTimer.current !== null) {
      clearTimeout(firstAudioTimer.current);
      firstAudioTimer.current = null;
    }
    if (loadingTimer.current !== null) {
      clearTimeout(loadingTimer.current);
      loadingTimer.current = null;
    }
    const ws = socket.current;
    socket.current = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    }
    const playing = source.current;
    source.current = null;
    startedAt.current = null;
    if (playing) {
      playing.onended = null;
      playing.stop();
    }
  }, []);

  const fail = useCallback(
    (gen: number, reason: QuestionTtsFailure) => {
      if (gen !== generation.current) return;
      release();
      setFailure(reason);
      setStatus("failed");
    },
    [release],
  );

  /** 디코드한 질문 음성을 처음부터 재생한다 */
  const startVoice = useCallback(
    async (gen: number, voice: CachedVoice) => {
      const audio = ensureContext();
      try {
        await audio.resume();
      } catch {
        // 아래에서 상태로 판단한다.
      }
      if (gen !== generation.current) return;
      if (audio.state !== "running") {
        fail(gen, "blocked");
        return;
      }
      const node = audio.createBufferSource();
      node.buffer = voice.buffer;
      node.connect(audio.destination);
      node.onended = () => {
        source.current = null;
        startedAt.current = null;
        setStatus("ended");
      };
      source.current = node;
      startedAt.current = audio.currentTime;
      node.start();
      setTimeline(voice.timeline);
      setStatus("playing");
    },
    [ensureContext, fail],
  );

  /** isFinal까지 누적한 조각을 한 번에 디코드하고 timeline을 만든 뒤 재생한다 */
  const finish = useCallback(
    async (gen: number, target: QuestionTtsTarget, chunks: ReceivedChunk[]) => {
      if (chunks.length === 0) {
        fail(gen, "playback");
        return;
      }
      let buffer: AudioBuffer;
      try {
        buffer = await ensureContext().decodeAudioData(concatBytes(chunks));
      } catch {
        fail(gen, "playback");
        return;
      }
      if (gen !== generation.current) return;
      const durations = splitDurationByBytes(
        chunks.map(({ bytes }) => bytes.length),
        buffer.duration * 1000,
      );
      const voice: CachedVoice = {
        buffer,
        timeline: buildTimeline(
          chunks.map(({ alignment }, i) => ({ durationMs: durations[i], alignment })),
        ),
      };
      cache.current.set(cacheKey(target), voice);
      await startVoice(gen, voice);
    },
    [ensureContext, fail, startVoice],
  );

  /** 5.12로 발급받은 토큰으로 바로 연결해 질문 글을 전송하고 음성을 수신한다 */
  const connect = useCallback(
    (
      gen: number,
      target: QuestionTtsTarget,
      token: Extract<TtsTokenActionResult, { ok: true }>,
    ) => {
      const ws = new WebSocket(buildStreamInputUrl(token));
      socket.current = ws;
      const chunks: ReceivedChunk[] = [];
      let opened = false;
      firstAudioTimer.current = setTimeout(() => fail(gen, "timeout"), FIRST_AUDIO_TIMEOUT_MS);

      ws.onopen = () => {
        opened = true;
        for (const message of buildStreamInputMessages(target.content)) {
          ws.send(JSON.stringify(message));
        }
      };
      ws.onmessage = (event: MessageEvent) => {
        const output = parseOutput(event.data);
        if (!output) return;
        // 끝 응답(isFinal)은 audio가 null이다. 음성 조각에 포함하지 않고 끝 신호로만 사용한다.
        if (output.isFinal === true) {
          release();
          void finish(gen, target, chunks);
          return;
        }
        if (typeof output.audio !== "string" || output.audio.length === 0) return;
        if (firstAudioTimer.current !== null) {
          clearTimeout(firstAudioTimer.current);
          firstAudioTimer.current = null;
        }
        chunks.push({ bytes: decodeBase64(output.audio), alignment: output.alignment ?? null });
      };
      ws.onerror = () => fail(gen, opened ? "closedEarly" : "connect");
      ws.onclose = () => fail(gen, opened ? "closedEarly" : "connect");
    },
    [fail, finish, release],
  );

  const stop = useCallback(() => {
    generation.current += 1;
    release();
    setFailure(null);
    setStatus("idle");
  }, [release]);

  const play = useCallback(
    (target: QuestionTtsTarget) => {
      stop();
      const gen = generation.current;
      lastTarget.current = target;
      setTimeline([]);
      setStatus("loading");
      loadingTimer.current = setTimeout(() => {
        fail(gen, "timeout");
        // 5.12를 기다리던 중이면 뒤늦게 도착한 토큰으로 연결하지 않도록 세대를 변경한다.
        generation.current += 1;
      }, LOADING_TIMEOUT_MS);
      // 버튼을 누른 동작 안에서 호출됐으면 그 동작으로 AudioContext를 재개(resume)한다.
      void ensureContext().resume();
      void (async () => {
        try {
          const token = await issueTtsToken(target.sessionId, target.questionId);
          // 기다리는 동안 stop · 다른 play가 호출됐으면 뒤늦게 도착한 토큰으로 연결하지 않는다.
          if (gen !== generation.current) return;
          if (!token.ok) {
            fail(gen, "token");
            return;
          }
          connect(gen, target, token);
        } catch {
          // 서버 액션 호출 자체가 실패(네트워크 끊김, 재배포 뒤 옛 화면의 액션 없음)하거나 WebSocket 생성에서 예외가 발생하면
          // 5초 타이머가 설정되기 전이므로 여기서 종료하지 않으면 loading 상태로 남는다.
          fail(gen, "token");
        }
      })();
    },
    [connect, ensureContext, fail, stop],
  );

  const replay = useCallback(() => {
    const target = lastTarget.current;
    if (!target) return;
    const cached = cache.current.get(cacheKey(target));
    if (!cached) {
      play(target);
      return;
    }
    stop();
    setStatus("loading");
    void startVoice(generation.current, cached);
  }, [play, startVoice, stop]);

  const getPlaybackMs = useCallback((): number | null => {
    const begin = startedAt.current;
    const audio = context.current;
    if (begin === null || !audio) return null;
    return (audio.currentTime - begin) * 1000;
  }, []);

  // 화면을 떠나면 연결 · 타이머 · 소리를 정리하고 AudioContext를 닫는다.
  useEffect(
    () => () => {
      generation.current += 1;
      release();
      if (resumeOnPointer.current) {
        window.removeEventListener("pointerdown", resumeOnPointer.current);
        resumeOnPointer.current = null;
      }
      const audio = context.current;
      context.current = null;
      if (audio) void audio.close();
    },
    [release],
  );

  return {
    status,
    failure,
    failureMessage: status === "failed" ? QUESTION_VOICE_FAILED : null,
    timeline,
    isSpeaking: status === "playing",
    getPlaybackMs,
    play,
    replay,
    stop,
  };
}
