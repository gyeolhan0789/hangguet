"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 기준: Figma S05(18:2333) 마이크 · 스피커 줄 · 스피커 [▶ 들어보기]
// 마이크와 스피커는 서버 · 소리 파일 없이 함께 확인한다(사용자 합의).
// 마이크 [녹음하기]로 3초 녹음(MediaRecorder) → 녹음이 끝나면 스피커 [들어보기]가 켜지고 → 누르면 녹음한 소리를 재생(<audio> blob 주소)
// → 들렸는지는 브라우저가 알 수 없으므로 사용자가 [잘 들려요]를 눌러야 스피커가 확인된다.

/** 녹음하는 시간 */
export const VOICE_RECORD_MS = 3000;

/**
 * idle 녹음 전 · recording 녹음 중 · recorded 녹음 끝(재생 전) · playing 재생 중 · played 재생 끝(들렸는지 묻는 중)
 * · confirmed [잘 들려요]로 확인함 · recordFailed 녹음 실패 · playFailed 재생 실패
 */
export type VoiceStatus =
  | "idle"
  | "recording"
  | "recorded"
  | "playing"
  | "played"
  | "confirmed"
  | "recordFailed"
  | "playFailed";

export interface VoiceCheck {
  status: VoiceStatus;
  /** 마이크로 3초 녹음한다 */
  record: () => void;
  /** 녹음한 소리를 재생한다(다시 들을 때도 같다) */
  play: () => void;
  /** 잘 들렸다고 확인한다 */
  confirm: () => void;
}

export function useVoiceCheck(stream: MediaStream | null): VoiceCheck {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const recording = useRef<() => void>(() => {});
  const url = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const record = useCallback(() => {
    const audioTracks = stream?.getAudioTracks() ?? [];
    let recorder: MediaRecorder;
    try {
      if (audioTracks.length === 0) throw new Error("마이크 없음");
      recorder = new MediaRecorder(new MediaStream(audioTracks));
    } catch {
      setStatus("recordFailed");
      return;
    }
    const chunks: Blob[] = [];
    let cancelled = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (cancelled) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      setStatus("recorded");
    };
    recorder.start();
    setStatus("recording");
    const timer = setTimeout(() => recorder.stop(), VOICE_RECORD_MS);
    recording.current = () => {
      cancelled = true;
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
    };
  }, [stream]);

  const play = useCallback(() => {
    if (!url.current) return;
    audio.current?.pause();
    const player = new Audio(url.current);
    audio.current = player;
    player.onended = () => setStatus("played");
    player.onerror = () => setStatus("playFailed");
    setStatus("playing");
    player.play().catch(() => setStatus("playFailed"));
  }, []);

  const confirm = useCallback(() => setStatus("confirmed"), []);

  // 녹음 중에 마이크 스트림이 바뀌면 녹음을 멈추고 처음으로 돌린다.
  useEffect(
    () => () => {
      recording.current();
      recording.current = () => {};
      setStatus((now) => (now === "recording" ? "idle" : now));
    },
    [stream],
  );

  // 화면을 떠나면 재생을 멈추고 blob 주소를 지운다.
  useEffect(
    () => () => {
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  return { status, record, play, confirm };
}
