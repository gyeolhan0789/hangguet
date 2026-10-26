"use client";

import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// 기준: Figma S06 Self Camera(18:2519: 오른쪽 24 · 위 88 · 240×160 · #2a2f3a · 테두리 흰색 20% · 둥글기 20 · user-round 72
// · Me Chip(왼 11 · rgba(14,16,22,.7) · mic 12 · '나' 12 Bold))
// · Controls(18:2544: 위 8 · 간격 20 · Mic 64(brand-strong · 그림자 0 0 12 rgba(255,122,38,.6) · mic 28) · Waveform 막대 14개 4px
// · 간격 4 · 흰색 70% · [답변 완료] 높이 56 · 흰색 · 둥글기 16 · check 20 · 17 Bold #191f28)
// · S06-F Mic Toast(18:4421: 500×56 · #191f28 · 둥글기 16 · 좌우 18 · mic-off 18 · 15 SemiBold 흰색 · '마이크 확인' 14 Bold brand · 화면 아래 44)
// · 모션 메모 S06(18:2569: 마이크 듣는 중 주황 링 펄스(scale 1→1.4, opacity .6→0, 1.2s 루프) · 파형은 실제 볼륨 연동)
// · 기획 · 모션 메모 S06-F(18:3575 · 18:4432: 마이크 입력이 10초 이상 0 → 하단 토스트 y 40→0 등장, 화상(S06)에서만)
// · API 명세 면접방 메시지([답변 완료] = answer.submit) · 사용자 결정(2026-10-26: [답변 완료]는 내 답변 자막이 있을 때만 누를 수 있다)

/** 파형 막대 높이(Figma Waveform 14개) */
const WAVE_HEIGHTS = [8, 14, 22, 30, 18, 26, 12, 20, 32, 16, 10, 24, 14, 8];
/** 소리가 없을 때 막대가 줄어드는 비율. 높이 = Figma 높이 × (최소 비율 + 나머지 × 소리 크기) */
const WAVE_MIN_RATIO = 0.25;
/** 마이크 입력이 이 시간 넘게 0이면 토스트를 띄운다(기획 메모 S06-F 10초) */
export const SILENT_TOAST_MS = 10_000;

/** S06 화상: 오른쪽 위 내 카메라. 카메라가 없으면 사람 아이콘을 둔다. */
export function SelfCamera({ stream }: { stream: MediaStream | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const cameraOn = Boolean(stream?.getVideoTracks().length);

  useEffect(() => {
    if (video.current) video.current.srcObject = cameraOn ? stream : null;
  }, [stream, cameraOn]);

  return (
    <div className="absolute top-[88px] right-4 z-10 h-[120px] w-[180px] overflow-hidden rounded-[20px] border border-white/20 bg-[#2a2f3a] md:right-6 md:h-40 md:w-60">
      <div className="absolute inset-0 flex items-center justify-center pb-4">
        <Image
          src="/interview/icon-user-round.svg"
          alt=""
          width={72}
          height={72}
          className="size-14 md:size-[72px]"
        />
      </div>
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        aria-label="내 카메라 화면"
        // 거울처럼 좌우를 뒤집어 보여 준다(S05 미리보기와 같게).
        className={`absolute inset-0 size-full -scale-x-100 object-cover ${cameraOn ? "" : "hidden"}`}
      />
      <span className="absolute bottom-[9px] left-[11px] flex items-center gap-1 rounded-full bg-[rgba(14,16,22,0.7)] px-2.5 py-1">
        <Image src="/interview/icon-mic-xs.svg" alt="" width={12} height={12} />
        <span className="text-xs leading-normal font-bold text-white">나</span>
      </span>
    </div>
  );
}

/** S06 화상: 아래 마이크 · 파형 · [답변 완료](누르면 에이전트에 답변을 내라고 보낸다) */
export function VideoControls({
  level,
  canSubmit = false,
  submitting = false,
  submitLabel = "답변 완료",
  onSubmit,
}: {
  level: MotionValue<number>;
  /** [답변 완료]를 누를 수 있다(질문이 있고 인식된 답변 글이 있으며 내는 중이 아님) */
  canSubmit?: boolean;
  /** 에이전트가 답변을 내는 중 */
  submitting?: boolean;
  submitLabel?: string;
  onSubmit?: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-center gap-5 pt-2">
      <MicButton />
      <Waveform level={level} />
      <button
        type="button"
        disabled={!canSubmit || submitting}
        aria-busy={submitting || undefined}
        onClick={onSubmit}
        className="flex h-14 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white px-6 disabled:cursor-default"
      >
        <Image src="/interview/icon-check.svg" alt="" width={20} height={20} />
        <span className="text-[17px] leading-normal font-bold whitespace-nowrap text-[#191f28]">
          {submitLabel}
        </span>
      </button>
    </div>
  );
}

/** 듣는 중 마이크. 주황 링이 퍼지며 사라지기를 되풀이한다. */
function MicButton() {
  const reduce = useReducedMotion();
  return (
    <span className="relative flex size-16 shrink-0 items-center justify-center">
      {!reduce && (
        <motion.span
          aria-hidden
          data-testid="mic-pulse"
          // 모션 메모 S06: 듣는 중 주황 링 펄스
          className="absolute inset-0 rounded-full border-2 border-brand-strong"
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeOut", repeat: Infinity }}
        />
      )}
      <span
        role="img"
        aria-label="마이크 듣는 중"
        className="relative flex size-16 items-center justify-center rounded-full bg-brand-strong drop-shadow-[0_0_12px_rgba(255,122,38,0.6)]"
      >
        <Image src="/interview/icon-mic.svg" alt="" width={28} height={28} loading="eager" />
      </span>
    </span>
  );
}

/** 마이크 소리 크기에 맞춰 움직이는 파형 */
function Waveform({ level }: { level: MotionValue<number> }) {
  return (
    <span aria-hidden data-testid="waveform" className="flex h-8 items-center gap-1">
      {WAVE_HEIGHTS.map((height, i) => (
        <WaveBar key={i} height={height} level={level} />
      ))}
    </span>
  );
}

function WaveBar({ height, level }: { height: number; level: MotionValue<number> }) {
  const scaled = useTransform(
    level,
    (value) => height * (WAVE_MIN_RATIO + (1 - WAVE_MIN_RATIO) * value),
  );
  return (
    <motion.span className="w-1 shrink-0 rounded-full bg-white/70" style={{ height: scaled }} />
  );
}

/**
 * 마이크 입력이 10초 넘게 0이면 화면 아래에 토스트를 띄우고, 소리가 다시 들어오면 내린다.
 * [마이크 확인](장치 점검 미니 모달)은 Figma에 모달 화면이 없어 글자만 둔다.
 */
export function MicToast({ level }: { level: MotionValue<number> }) {
  const reduce = useReducedMotion();
  const [silent, setSilent] = useState(false);
  // 소리 크기가 0이 된 때. 소리가 있으면 null
  const since = useRef<number | null>(null);

  useMotionValueEvent(level, "change", (value) => {
    if (value > 0) {
      since.current = null;
      setSilent(false);
    } else {
      since.current ??= performance.now();
    }
  });

  // 소리 크기가 0에 머물면 change가 오지 않으므로, 1초마다 0이 이어진 시간을 확인한다.
  useEffect(() => {
    if (level.get() === 0) since.current ??= performance.now();
    const timer = setInterval(() => {
      if (since.current !== null && performance.now() - since.current >= SILENT_TOAST_MS) {
        setSilent(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [level]);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-11 z-30 flex justify-center px-4"
    >
      <AnimatePresence>
        {silent && (
          <motion.div
            className="flex h-14 w-full max-w-[500px] items-center gap-2.5 rounded-2xl bg-[#191f28] px-[18px]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <Image src="/interview/icon-mic-off.svg" alt="" width={18} height={18} />
            <span className="text-[15px] leading-normal font-semibold text-white">
              마이크 소리가 들리지 않아요
            </span>
            <span className="flex-1" />
            <span className="text-sm leading-normal font-bold whitespace-nowrap text-brand">
              마이크 확인
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
