"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cycleTabFocus } from "@/components/cycle-tab-focus";

// 기준: Figma S06-F 연결 끊김(18:4323: Reconnect Banner 600×48 · 위 80 · #ffb547 · 둥글기 999 · wifi-off 18 · 15 Bold #3d2600
// '연결이 불안정해요 · 다시 연결하는 중… N초' / Dim rgba(11,13,20,.6) · Modal 420 · 흰색 · 둥글기 24 · 패딩 32 · 간격 16
// · 그림자 0 20 48 rgba(25,33,40,.25) · Icon Tile 56(#fff6dd · 둥글기 20 · pause 28) · 제목 22 Bold #191f28 · 본문 15 Medium #4e5968
// · 버튼 높이 52 · 둥글기 14 · 간격 10 · 위 8: [면접 끝내기](#f2f4f6 · 16 Bold #191f28) · [다시 시도](brand-strong · rotate-cw 18 · 16 Bold 흰색))
// · Figma S06-F2 면접관 연결 실패(345:1815: 같은 모달, circle-alert · '면접관을 연결하지 못했어요' · '다시 시작해 주세요' · [나가기] · [다시 시작])
// · 기획 메모 S06-F(18:3575: 상단 배너 + 자동 재연결 카운트, 5초 넘게 실패하면 '잠시 멈춤' 카드) · S06-F2(340:1886: 5.2 START_FAILED면
// 이 카드, [다시 시작] → 5.4 · [나가기] → 홈) · 웹 Swagger 5.14(끊기면 입장 정보를 다시 받아 재접속)
// · 사용자 요청(2026-10-27: 카드에 '답하던 질문은 처음부터 다시 답해요' 추가)
// · 사용자 요청(2026-11-06: S06-F2 [다시 시작]을 RESTART_WAIT_SECONDS 동안 막고 남은 초를 버튼에 보인다. 그동안 본문은
//   '면접관을 다시 준비하고 있어요 · 잠시 뒤 다시 시작할 수 있어요'. 근거: 이해준/agent_autoscale_plan/be-requests.md 1.1)
// S06 계열은 라이트 · 다크 구분 없는 화면이라 Figma 값을 그대로 쓴다(end-modal과 같음).

/** 다시 연결하는 중이 이 시간을 넘기면 '면접이 잠시 멈췄어요' 카드를 띄운다(기획 메모 S06-F 5초) */
export const PAUSE_AFTER_MS = 5000;

/** 연결이 불안정할 때 화면 위 배너. 다시 연결하기 시작한 뒤 지난 초를 센다. */
export function ReconnectBanner({ seconds }: Readonly<{ seconds: number }>) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="status"
      className="absolute top-20 left-1/2 z-20 flex h-12 w-[min(600px,calc(100%-32px))] -translate-x-1/2 items-center justify-center gap-2.5 rounded-full bg-[#ffb547] px-[18px]"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      <Image src="/interview/icon-wifi-off.svg" alt="" width={18} height={18} />
      <span className="text-[15px] leading-normal font-bold tracking-[-0.2px] whitespace-nowrap text-[#3d2600]">
        연결이 불안정해요 · 다시 연결하는 중… {seconds}초
      </span>
    </motion.div>
  );
}

/** 다시 연결하는 중이면 지난 초를 센다. 연결되면(reconnecting false) 0으로 돌아간다. */
export function useReconnectSeconds(reconnecting: boolean) {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(reconnecting);
  if (running !== reconnecting) {
    setRunning(reconnecting);
    setSeconds(0);
  }
  useEffect(() => {
    if (!reconnecting) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [reconnecting]);
  return seconds;
}

/**
 * 면접관 연결 실패(START_FAILED) 뒤 [다시 시작]을 막는 시간(초).
 * 면접관 서버가 연결을 닫지 못하고 사라지면 LiveKit이 그 서버를 약 2분 동안 살아 있는 것으로 보고 면접을 배정한다.
 * 바로 다시 시작하면 같은 서버에 또 배정돼 다시 실패할 수 있어 잠시 기다리게 한다(be-requests.md 1.1).
 */
export const RESTART_WAIT_SECONDS = 60;

/** active가 켜지면 from초부터 1초씩 줄여 0에서 멈춘다. 꺼졌다 다시 켜지면 처음부터 센다. */
function useCountdown(active: boolean, from: number) {
  const [left, setLeft] = useState(active ? from : 0);
  const [running, setRunning] = useState(active);
  if (running !== active) {
    setRunning(active);
    setLeft(active ? from : 0);
  }
  const counting = active && left > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  return left;
}

/** S06-F · S06-F2 공통 모달 틀(안쪽에서만 Tab이 돈다) */
function RoomModal({
  open,
  icon,
  title,
  children,
  buttons,
}: Readonly<{
  open: boolean;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  buttons: ReactNode;
}>) {
  const reduce = useReducedMotion();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLButtonElement>("button:last-of-type")?.focus();
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    cycleTabFocus(event, items);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(11,13,20,0.6)] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            ref={dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="room-alert-title"
            aria-describedby="room-alert-description"
            onKeyDown={onKeyDown}
            className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-3xl bg-white p-8 tracking-[-0.2px] drop-shadow-[0_20px_48px_rgba(25,33,40,0.25)]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.3 }}
          >
            <span className="flex size-14 items-center justify-center rounded-[20px] bg-[#fff6dd]">
              {icon}
            </span>
            <h2
              id="room-alert-title"
              className="text-[22px] leading-normal font-bold whitespace-nowrap text-[#191f28]"
            >
              {title}
            </h2>
            <p
              id="room-alert-description"
              className="text-center text-[15px] leading-normal font-medium whitespace-pre-line text-[#4e5968]"
            >
              {children}
            </p>
            <div className="flex w-full gap-2.5 pt-2">{buttons}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const secondaryButton =
  "flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-[#f2f4f6] px-6 text-base leading-normal font-bold text-[#191f28] disabled:cursor-wait";
const primaryButton =
  "flex h-[52px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-brand-strong px-6 text-base leading-normal font-bold text-white disabled:cursor-wait disabled:opacity-60";

/** S06-F 면접이 잠시 멈췄어요: [면접 끝내기] → S06-E · [다시 시도] → 입장 정보를 다시 받아 들어간다(5.14) */
export function PausedModal({
  open,
  onEnd,
  onRetry,
}: Readonly<{
  open: boolean;
  onEnd: () => void;
  onRetry: () => void;
}>) {
  return (
    <RoomModal
      open={open}
      icon={<Image src="/interview/icon-pause.svg" alt="" width={28} height={28} />}
      title="면접이 잠시 멈췄어요"
      buttons={
        <>
          <button type="button" onClick={onEnd} className={secondaryButton}>
            면접 끝내기
          </button>
          <button type="button" onClick={onRetry} className={primaryButton}>
            <Image src="/devices/icon-rotate-cw.svg" alt="" width={18} height={18} />
            다시 시도
          </button>
        </>
      }
    >
      {
        "연결되면 이어서 진행돼요\n지금까지 답변은 저장돼 있어요\n답하던 질문은 처음부터 다시 답해요"
      }
    </RoomModal>
  );
}

/**
 * 그룹 면접이 면접관 장애로 끝났을 때(API 명세 10.11 endReason AI_FAILURE: 면접관 연결이 끊겨 면접을 마쳤다고 안내한다
 * · 그룹 설계 6.11-5 문구 '면접관 연결이 끊겨 면접을 마쳤습니다'). 본문은 두지 않는다(사용자 결정 2026-11-13, 빈칸 기본안).
 * [확인] → 다시 그려 결과 분석(또는 홈)으로 넘어간다.
 */
export function GroupAiFailureModal({
  open,
  onConfirm,
}: Readonly<{ open: boolean; onConfirm: () => void }>) {
  return (
    <RoomModal
      open={open}
      icon={<Image src="/interview/icon-wifi-off.svg" alt="" width={28} height={28} />}
      title="면접관 연결이 끊겨 면접을 마쳤습니다"
      buttons={
        <button type="button" onClick={onConfirm} className={primaryButton} autoFocus>
          확인
        </button>
      }
    >
      {null}
    </RoomModal>
  );
}

/** S06-F2 면접관을 연결하지 못했어요(5.2 START_FAILED): [나가기] → 홈 · [다시 시작] → 5.4 */
export function StartFailedModal({
  open,
  restarting,
  error,
  onLeave,
  onRestart,
}: Readonly<{
  open: boolean;
  restarting: boolean;
  /** 다시 시작(5.4)이 실패했을 때 서버 문구 */
  error?: string;
  onLeave: () => void;
  onRestart: () => void;
}>) {
  const waitLeft = useCountdown(open, RESTART_WAIT_SECONDS);
  const waiting = waitLeft > 0;
  return (
    <RoomModal
      open={open}
      icon={<Image src="/interview/icon-circle-alert.svg" alt="" width={28} height={28} />}
      title="면접관을 연결하지 못했어요"
      buttons={
        <>
          <button type="button" onClick={onLeave} disabled={restarting} className={secondaryButton}>
            나가기
          </button>
          <button
            type="button"
            onClick={onRestart}
            disabled={restarting || waiting}
            aria-busy={restarting || undefined}
            className={primaryButton}
          >
            <Image src="/devices/icon-rotate-cw.svg" alt="" width={18} height={18} />
            다시 시작
            {/* 남은 초는 본문 문구로 알리므로 버튼 이름에서는 뺀다(스크린 리더가 1초마다 읽지 않게) */}
            {waiting && <span aria-hidden="true">({waitLeft}초)</span>}
          </button>
        </>
      }
    >
      {error ??
        (waiting
          ? "면접관을 다시 준비하고 있어요\n잠시 뒤 다시 시작할 수 있어요"
          : "다시 시작해 주세요")}
    </RoomModal>
  );
}
