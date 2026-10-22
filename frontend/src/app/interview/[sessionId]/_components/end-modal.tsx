"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";

import { endSession } from "@/lib/interview/actions";
import { useInterviewStore } from "@/stores/interview-store";

// 기준: Figma S06-E 면접 종료 확인(18:4226: Dim rgba(11,13,20,.65) · Modal 440 · 흰색 · 둥글기 24 · 패딩 32 · 간격 16
// · 그림자 0 20 24 rgba(25,33,40,.25) · Icon Tile 56(#f2f4f6 · 둥글기 20 · door-open 28) · '면접을 끝낼까요?' 24 ExtraBold #191f28
// · '지금 끝내면 답변한 2개 질문까지만 / 결과가 나와요' 15 Medium #4e5968 · Streak Info(#eaf8f1 · flame 14 · '오늘 스트릭은 인정돼요' 13 Bold #1fb57a)
// · 버튼 높이 52 · 둥글기 14 · 간격 10 · 위 8: [끝내기](#f2f4f6 · 16 Bold #f04452) · [계속하기](brand-strong · 16 Bold 흰색))
// · 기획 메모 S06-E(18:3508: 안전한 쪽(계속하기)을 강조, 끝내기 → S06-1, 답변 0개면 '결과 없이 나가요' 문구 + 스트릭 미인정)
// · 모션 메모 S06-E(18:4318: 배경 dim 페이드 + 모달 팝, 답변 0개일 때는 '결과 없이 나가요 · 스트릭 미인정' 문구로 교체)
// · Swagger 5.8 면접 끝내기 · API 명세 5.8(답변 ≥1이면 그날 연습으로 인정, 0개면 결과 · 연습 인정 없이 끝남)
// S06 계열은 라이트 · 다크 구분 없는 화면이라, 모달 색은 테마에 따라 바뀌는 토큰 대신 Figma 값을 그대로 쓴다.

/** S06-E 면접 종료 확인 모달 */
export function EndModal({
  sessionId,
  answeredCount,
}: {
  sessionId: number;
  answeredCount: number;
}) {
  const reduce = useReducedMotion();
  const open = useInterviewStore((state) => state.endOpen);
  const closeEnd = useInterviewStore((state) => state.closeEnd);
  const setLeveledUp = useInterviewStore((state) => state.setLeveledUp);
  const [pending, startEnd] = useTransition();
  const [error, setError] = useState<string>();
  const key = useRef<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  // 열리면 안전한 쪽([계속하기])에 포커스를 둔다.
  useEffect(() => {
    if (open) keep.current?.focus();
  }, [open]);

  function close() {
    setError(undefined);
    closeEnd();
  }

  function end() {
    setError(undefined);
    key.current ??= crypto.randomUUID();
    startEnd(async () => {
      const result = await endSession(sessionId, key.current!);
      if (result.keyReused) key.current = null;
      if (result.formError) setError(result.formError);
      else {
        setLeveledUp(result.leveledUp ?? null);
        close();
      }
    });
  }

  // Esc로 닫고, 모달 안에서만 Tab이 돈다(aria-modal). 끝내는 중에는 닫지 않는다.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      close();
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

  const noAnswer = answeredCount === 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(11,13,20,0.65)] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-title"
            aria-describedby="end-description"
            onKeyDown={onKeyDown}
            // Figma 모달은 화면 가운데보다 9px 위(위 260 · 높이 362)
            className="mb-[18px] flex w-full max-w-[440px] flex-col items-center gap-4 rounded-3xl bg-white p-8 drop-shadow-[0_20px_24px_rgba(25,33,40,0.25)]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.3 }}
          >
            <span className="flex size-14 items-center justify-center rounded-[20px] bg-[#f2f4f6]">
              <Image src="/interview/icon-door-open.svg" alt="" width={28} height={28} />
            </span>
            <h2
              id="end-title"
              className="text-2xl leading-normal font-extrabold whitespace-nowrap text-[#191f28]"
            >
              면접을 끝낼까요?
            </h2>
            <p
              id="end-description"
              className="text-center text-[15px] leading-normal font-medium text-[#4e5968]"
            >
              {noAnswer ? (
                "결과 없이 나가요 · 스트릭 미인정"
              ) : (
                <>
                  지금 끝내면 답변한 {answeredCount}개 질문까지만
                  <br />
                  결과가 나와요
                </>
              )}
            </p>
            {!noAnswer && (
              <span className="flex items-center gap-1.5 rounded-full bg-[#eaf8f1] px-3.5 py-2">
                <Image src="/interview/icon-flame-success.svg" alt="" width={14} height={14} />
                <span className="text-[13px] leading-normal font-bold text-[#1fb57a]">
                  오늘 스트릭은 인정돼요
                </span>
              </span>
            )}
            <div className="flex w-full gap-2.5 pt-2">
              <button
                type="button"
                onClick={end}
                disabled={pending}
                aria-busy={pending || undefined}
                className="flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-[#f2f4f6] px-6 text-base leading-normal font-bold text-[#f04452] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f04452] disabled:cursor-wait"
              >
                끝내기
              </button>
              <button
                ref={keep}
                type="button"
                onClick={close}
                disabled={pending}
                className="flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-brand-strong px-6 text-base leading-normal font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong disabled:cursor-not-allowed"
              >
                계속하기
              </button>
            </div>
            {error && (
              <p
                role="alert"
                className="text-center text-[13px] leading-normal font-medium text-[#f04452]"
              >
                {error}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
