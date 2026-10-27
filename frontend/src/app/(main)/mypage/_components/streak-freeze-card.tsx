"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition } from "react";

import { useLockScroll } from "@/components/use-lock-scroll";
import type { MyStreakFreezesResponse, StreakFreezeItem } from "@/types/api";
import { applyStreakFreeze } from "@/lib/user/actions";
import { useToastStore } from "@/stores/toast-store";

// 기준: Figma S09 마이페이지 스트릭 유지권 박스(18:3075 · 다크 18:6474: bg-sub · 둥글기 24 · 패딩 24 · 간격 16 · '스트릭 유지권' 18 Bold
// · '소유한 유지권 N개' 24 Bold(개수 brand-strong) · 줄마다 날짜 17 SemiBold · 'MM.DD까지' 13 Medium text-3 · [메우기] brand-strong
// 높이 42 · 둥글기 12 · 안내 13 Medium text-3) · S09-2 사용 확인 모달(265:1314 · 다크 266:1614) · S09-3 사용 완료 모달(266:1553 · 다크
// 266:1866: 너비 440 · 제목 22 Bold · dim 라이트 rgba(11,13,20,.65) · 다크 black/60 · 그림자 0 20 48 · 다크 1px line 테두리) · Swagger 8.13 내 스트릭 유지권
// (MyStreakFreezesResponse) · 8.14 유지권 사용(StreakFreezeUseResponse · 404 · 409 서버 문구)
// · 기획 메모 S09(없으면 '아직 받은 유지권이 없어요') · S09-2([취소] · Esc → 닫기, 실패는 서버 문구) · S09-3([확인] → 닫기)

const HELP = "유지권마다 메울 수 있는 날짜가 정해져 있어요. 받은 날부터 2주 동안 쓸 수 있어요";

/** 2026-10-19 → 10월 19일 */
function koreanDay(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}월 ${day}일`;
}

/** 만료 일시(+09:00) → 11.03까지 */
function until(expiresAt: string) {
  return `${expiresAt.slice(5, 10).replace("-", ".")}까지`;
}

export function StreakFreezeCard({ freezes }: { freezes: MyStreakFreezesResponse }) {
  const [target, setTarget] = useState<StreakFreezeItem | null>(null);

  return (
    <section
      aria-labelledby="streak-freeze-title"
      className="flex min-w-0 flex-1 flex-col gap-4 rounded-3xl bg-bg-sub p-5 sm:p-6 lg:h-[400px]"
    >
      <h2
        id="streak-freeze-title"
        className="text-lg leading-normal font-bold tracking-[-0.2px] text-text-1"
      >
        스트릭 유지권
      </h2>
      {freezes.freezes.length === 0 ? (
        <p className="text-[15px] leading-normal font-medium tracking-[-0.2px] text-text-3">
          아직 받은 유지권이 없어요
        </p>
      ) : (
        <>
          <p className="text-2xl leading-normal font-bold tracking-[-0.2px] text-text-1">
            소유한 유지권 <span className="text-brand-strong">{freezes.availableCount}개</span>
          </p>
          <ul className="flex flex-col border-t border-line">
            {freezes.freezes.map((freeze) => (
              <li key={freeze.id} className="flex items-center gap-3 border-b border-line py-4">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 tracking-[-0.2px]">
                  <span className="text-[17px] leading-normal font-semibold text-text-1">
                    {koreanDay(freeze.fillableDate)}
                  </span>
                  <span className="text-[13px] leading-normal font-medium text-text-3">
                    {until(freeze.expiresAt)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setTarget(freeze)}
                  className="flex h-[42px] cursor-pointer items-center rounded-xl bg-brand-strong px-5 text-[15px] leading-normal font-bold tracking-[-0.2px] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  메우기
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[13px] leading-normal font-medium tracking-[-0.2px] text-text-3">
            {HELP}
          </p>
        </>
      )}
      <StreakFreezeModal freeze={target} onClose={() => setTarget(null)} />
    </section>
  );
}

const button =
  "flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] text-base leading-normal font-bold tracking-[-0.2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed";

/** S09-2 사용 확인 → 8.14 성공이면 S09-3 사용 완료. 실패하면 닫고 서버 문구를 토스트로 알린다. */
function StreakFreezeModal({
  freeze,
  onClose,
}: {
  freeze: StreakFreezeItem | null;
  onClose: () => void;
}) {
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const show = useToastStore((state) => state.show);
  const open = freeze !== null;
  useLockScroll(open);

  function close() {
    setDone(false);
    onClose();
  }

  function fill() {
    if (!freeze) return;
    startTransition(async () => {
      const result = await applyStreakFreeze(freeze.id);
      if (result.used) {
        setDone(true);
        return;
      }
      close();
      if (result.error) show({ text: result.error });
    });
  }

  return (
    <AnimatePresence>
      {freeze && (
        <motion.div
          key="dim"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,13,20,0.65)] px-4 dark:bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !done && !pending) close();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="streak-freeze-modal-title"
            className="flex w-full max-w-[440px] flex-col items-center gap-3 rounded-3xl bg-bg-sub px-8 pt-9 pb-8 text-center shadow-[0_20px_48px_rgba(0,0,0,0.25)] dark:border dark:border-line dark:shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <h2
              id="streak-freeze-modal-title"
              className="text-[22px] leading-normal font-bold tracking-[-0.2px] text-text-1"
            >
              {done ? "유지권 사용 완료!" : "스트릭 유지권을 사용하시겠습니까?"}
            </h2>
            {!done && (
              <p className="text-base leading-normal font-medium tracking-[-0.2px] text-text-2">
                날짜 : {freeze.fillableDate.replaceAll("-", ".")}
              </p>
            )}
            <div className="mt-3 flex w-full gap-2.5">
              {done ? (
                <button
                  type="button"
                  autoFocus
                  onClick={close}
                  className={`${button} bg-brand-strong text-white`}
                >
                  확인
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    autoFocus
                    onClick={close}
                    disabled={pending}
                    className={`${button} bg-surface text-text-2`}
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={fill}
                    disabled={pending}
                    aria-busy={pending || undefined}
                    className={`${button} bg-brand-strong text-white`}
                  >
                    메우기
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
