"use client";

import { AnimatePresence, motion, useReducedMotion, type MotionValue } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { LevelMeter } from "@/components/level-meter";
import { Spinner } from "@/components/spinner";
import { useVoiceCheck, type VoiceStatus } from "@/components/use-voice-check";
import { PLAY_TEXT, RECORD_TEXT } from "@/lib/devices/voice-text";

// S06-F [마이크 확인] 미니 모달: 지금 잡힌 마이크 · 소리 크기 · 녹음해서 들어보기.
// 기준: 기획 메모 S06-F(18:3575: [마이크 확인] = S05 장치 점검 미니 모달) — Figma에 모달 화면이 없어
// 사용자 결정(2026-11-09: 지금 잡힌 장치와 녹음 · 재생을 보여 주는 미니 모달, 녹음하는 3초 동안은 면접방 송출을 멈춘다)으로 만들었다.
// · 모달 틀은 S06-E 면접 종료 확인(18:4226: Dim rgba(11,13,20,.65) · 흰색 · 둥글기 24 · 패딩 32 · 간격 16 · Icon Tile 56 #f2f4f6
//   · 제목 24 ExtraBold #191f28 · 설명 15 Medium #4e5968 · 버튼 높이 52 · 둥글기 14 · brand-strong)
// · 소리 크기 막대 · 문구는 S05 장치 점검(18:2388 Mic Level · 18:2434 마이크 줄 · 18:2455 Button 들어보기: 높이 36 · 둥글기 10 · 14 Bold)
// S06 계열은 라이트 · 다크 구분 없는 화면이라, 모달 색은 테마에 따라 바뀌는 토큰 대신 Figma 값을 그대로 쓴다.

/** 녹음 · 재생 상태별 안내 문구(S05와 같은 문구) */
const VOICE_TEXT: Record<VoiceStatus, string> = {
  idle: RECORD_TEXT.idle,
  recording: RECORD_TEXT.recording,
  recordFailed: RECORD_TEXT.failed,
  recorded: PLAY_TEXT.ready,
  playing: PLAY_TEXT.playing,
  played: PLAY_TEXT.played,
  confirmed: PLAY_TEXT.played,
  playFailed: PLAY_TEXT.failed,
};

/** 마이크를 찾지 못했을 때(S05 마이크 줄 실패 문구) */
export const MIC_MISSING_TEXT = "장치를 찾을 수 없어요";

/** S06-F [마이크 확인] 미니 모달. 닫으면 녹음 · 재생을 멈추고 처음으로 돌린다. */
export function MicCheckModal({
  open,
  onClose,
  stream,
  level,
  onPauseSending,
}: {
  open: boolean;
  onClose: () => void;
  /** 면접에서 쓰는 카메라 · 마이크 */
  stream: MediaStream | null;
  /** 마이크 소리 크기(0~1) */
  level: MotionValue<number>;
  /** 녹음하는 동안 면접방 송출을 멈추고(true), 끝나면 다시 보낸다(false) */
  onPauseSending: (paused: boolean) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <MicCheckDialog
          onClose={onClose}
          stream={stream}
          level={level}
          onPauseSending={onPauseSending}
        />
      )}
    </AnimatePresence>
  );
}

function MicCheckDialog({
  onClose,
  stream,
  level,
  onPauseSending,
}: {
  onClose: () => void;
  stream: MediaStream | null;
  level: MotionValue<number>;
  onPauseSending: (paused: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const voice = useVoiceCheck(stream);
  const microphone = stream?.getAudioTracks()[0];
  const live = microphone !== undefined && microphone.readyState !== "ended";
  const device = live ? microphone.label || "마이크" : MIC_MISSING_TEXT;
  const recording = voice.status === "recording";
  const recorded = !["idle", "recording", "recordFailed"].includes(voice.status);

  // 열리면 [닫기]에 포커스를 둔다.
  useEffect(() => close.current?.focus(), []);

  // 녹음하는 동안만 면접방 송출을 멈춘다(테스트한 말이 답변에 섞이지 않게). 닫거나 녹음이 끝나면 다시 보낸다.
  useEffect(() => {
    if (!recording) return;
    onPauseSending(true);
    return () => onPauseSending(false);
  }, [recording, onPauseSending]);

  // Esc로 닫고, 모달 안에서만 Tab이 돈다(aria-modal).
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const buttons = [
      ...dialog.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(11,13,20,0.65)] px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      // 바깥(어두운 배경)을 누르면 닫는다
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mic-check-title"
        aria-describedby="mic-check-device"
        onKeyDown={onKeyDown}
        className="flex w-full max-w-[440px] flex-col items-center gap-4 rounded-3xl bg-white p-8 drop-shadow-[0_20px_24px_rgba(25,33,40,0.25)]"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
        transition={{ type: "spring", duration: 0.35, bounce: 0.3 }}
      >
        <span className="flex size-14 items-center justify-center rounded-[20px] bg-[#f2f4f6]">
          <Image src="/devices/icon-mic.svg" alt="" width={28} height={28} />
        </span>
        <h2
          id="mic-check-title"
          className="text-2xl leading-normal font-extrabold whitespace-nowrap text-[#191f28]"
        >
          마이크 확인
        </h2>
        <p
          id="mic-check-device"
          className={`max-w-full truncate text-center text-[15px] leading-normal font-medium ${live ? "text-[#4e5968]" : "text-[#f04452]"}`}
        >
          {device}
        </p>
        {/* S05 Mic Level처럼 어두운 띠 위에 소리 크기 막대 */}
        <div className="flex h-11 w-full items-center gap-3 rounded-[14px] bg-[#1b1f2a] px-4">
          <Image src="/devices/icon-mic-white.svg" alt="" width={18} height={18} />
          <LevelMeter level={level} />
        </div>
        <div className="flex w-full items-center gap-2 rounded-2xl bg-[#f9fafb] px-4 py-3">
          <p
            role="status"
            className={`min-w-0 flex-1 text-sm leading-normal font-medium tracking-[-0.2px] ${
              voice.status === "recordFailed" || voice.status === "playFailed"
                ? "text-[#f04452]"
                : "text-[#4e5968]"
            }`}
          >
            {VOICE_TEXT[voice.status]}
          </p>
          <VoiceButton
            icon="/devices/icon-mic.svg"
            onClick={voice.record}
            disabled={!live}
            pending={recording}
          >
            {recording
              ? "녹음 중"
              : recorded || voice.status === "recordFailed"
                ? "다시 녹음"
                : "녹음하기"}
          </VoiceButton>
          {recorded && (
            <VoiceButton
              icon="/devices/icon-play.svg"
              onClick={voice.play}
              pending={voice.status === "playing"}
            >
              들어보기
            </VoiceButton>
          )}
        </div>
        <button
          ref={close}
          type="button"
          onClick={onClose}
          className="mt-2 flex h-[52px] w-full cursor-pointer items-center justify-center rounded-[14px] bg-brand-strong px-6 text-base leading-normal font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong"
        >
          닫기
        </button>
      </motion.div>
    </motion.div>
  );
}

/** 녹음 · 재생 버튼(S05 Button 들어보기 18:2455: 높이 36 · 둥글기 10 · 14 Bold · 아이콘 14) */
function VoiceButton({
  icon,
  children,
  onClick,
  disabled = false,
  pending = false,
}: {
  icon: string;
  children: string;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className="flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-[#f2f4f6] px-3.5 text-sm leading-normal font-bold tracking-[-0.2px] whitespace-nowrap text-[#191f28] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:text-[#8b95a1]"
    >
      {pending ? (
        <Spinner size={14} className="bg-[#8b95a1]" />
      ) : (
        <Image src={icon} alt="" width={14} height={14} />
      )}
      {children}
    </button>
  );
}
