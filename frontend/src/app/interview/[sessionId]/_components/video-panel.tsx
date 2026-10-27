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
// · STT Bubble 맨 아래 줄(18:2539 Bottom: Waveform 막대 14개 4px · 간격 4 · 흰색 70% · [답변 완료] 높이 44 · 흰색 · 둥글기 12 · 좌우 18
// · check 20 · 17 Bold #191f28) · 사용자 요청(2026-10-27: 마이크는 빼고 파형 오른쪽에 [답변 완료])
// · S06-Q(344:1577: 질문 음성이 나오는 동안 파형 30% · [답변 완료] 잠김)
// · S06-A 답변 상태 토스트(344:1649: 500 · #191f28 · 둥글기 16 · 좌우 18 · 간격 10 · circle-alert 18 danger · 15 SemiBold 흰색
// · 오른쪽 '다시 시도' 14 Bold brand)
// · S06-F Mic Toast(18:4421: 500×56 · #191f28 · 둥글기 16 · 좌우 18 · mic-off 18 · 15 SemiBold 흰색 · '마이크 확인' 14 Bold brand · 화면 아래 44)
// · 모션 메모 S06(18:2569: 파형은 실제 볼륨 연동)
// · 기획 · 모션 메모 S06-F(18:3575 · 18:4432: 마이크 입력이 10초 이상 0 → 하단 토스트 y 40→0 등장, 화상(S06)에서만)

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

/**
 * S06 화상: 내 답변 상자 맨 아래 줄 — 오른쪽에 파형 · [답변 완료](누르면 에이전트에 답변을 내라고 보낸다)
 * (사용자 요청 2026-10-27: 마이크는 빼고, 파형 오른쪽에 [답변 완료]를 둔다. 말을 멈추면 에이전트가 스스로 내기도 한다)
 */
export function VideoControls({
  level,
  canSubmit = false,
  submitting = false,
  locked = false,
  onSubmit,
}: {
  level: MotionValue<number>;
  /** [답변 완료]를 누를 수 있다(질문이 있고 인식된 답변 글이 있으며 내는 중이 아님) */
  canSubmit?: boolean;
  /** 에이전트가 답변을 내는 중 */
  submitting?: boolean;
  /** 면접관이 질문을 말하는 중(파형을 흐리게) */
  locked?: boolean;
  onSubmit?: () => void;
}) {
  return (
    <div className="flex w-full items-center justify-end gap-3">
      <span className={locked ? "opacity-30" : undefined}>
        <Waveform level={level} />
      </span>
      <button
        type="button"
        disabled={!canSubmit || submitting}
        aria-busy={submitting || undefined}
        onClick={onSubmit}
        className="flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white px-[18px] disabled:cursor-default disabled:opacity-40"
      >
        <Image src="/interview/icon-check.svg" alt="" width={20} height={20} />
        <span className="text-[17px] leading-normal font-bold tracking-[-0.2px] whitespace-nowrap text-[#191f28]">
          답변 완료
        </span>
      </button>
    </div>
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

/**
 * S06-A 답변 상태 토스트. 에이전트가 보낸 답변 상태(answer.state)를 내 답변 상자 위에 한 줄로 알린다.
 * action이 있으면 오른쪽 끝에 그 버튼을 둔다(제출 실패 → [다시 시도]).
 */
export function AnswerNotice({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role={action ? "alert" : "status"}
      className="flex min-h-14 w-full max-w-[500px] items-center gap-2.5 self-center rounded-2xl bg-[#191f28] px-[18px] py-3 tracking-[-0.2px]"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Image src="/interview/icon-circle-alert.svg" alt="" width={18} height={18} />
      <span className="min-w-0 flex-1 text-[15px] leading-normal font-semibold break-keep text-white">
        {message}
      </span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="shrink-0 cursor-pointer text-sm leading-normal font-bold whitespace-nowrap text-brand disabled:cursor-default disabled:opacity-60"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
