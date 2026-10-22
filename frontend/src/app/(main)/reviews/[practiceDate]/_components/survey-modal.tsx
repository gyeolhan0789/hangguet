"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useLockScroll } from "@/components/use-lock-scroll";
import { useToastStore } from "@/stores/toast-store";

// 기준: Figma S08-B Survey Modal(18:4690: Dim rgba(25,33,40,.5) · 모달 520 · p36 둥글기 28 간격 16 bg-sub · 그림자 0 20 24 rgba(25,33,40,.25)
// · 닫기 X 22(오른쪽 위 24) · 아이콘 타일 80 둥글기 24 brand-soft · message-circle-heart 40 · 제목 26 ExtraBold
// · 본문 16 Medium text-2 가운데 행간 1.6 폭 440 · 칩 '질문 5개 · 약 1분' timer 13 · 13 Bold text-2 · px14 py8
// · 버튼 pt8 간격 10 각 h56 둥글기 14 16 Bold — [다음에 할게요] surface · [설문 참여하기] brand-strong + external-link 18)
// · 기획 메모 S08-B(18:3679: 3일째 · 7일째 · 21일 완주에 S08 위로 노출, [설문 참여하기] → 구글폼 새 탭(유저 ID · 스트릭 일수 쿼리),
//   참여하면 같은 회차 다시 안 뜸) · 모션 메모 S08-B(18:4715: 진입 1.2초 뒤 노출, dim 페이드 + 모달 y 32 → 0 spring, 아이콘 타일
//   rotate [-8, 8, 0], 돌아오면 '고마워요!' 토스트, [다음에 할게요] / ✕ → 다음 날 홈 배너(이번 범위 밖))
// · WAI-ARIA APG 대화상자 패턴(안에서만 Tab, Esc로 닫힘)
// · 사용자 결정(2026-10-22: 구글폼 주소는 환경 변수 NEXT_PUBLIC_SURVEY_URL로 받고({userId} · {streak} 자리 표시),
//   없으면 띄우지 않는다, 본 회차는 회원별로 브라우저 저장소에 적어 다시 띄우지 않는다)

/** 성장 리뷰에 들어오고 설문을 띄우기까지(모션 메모 1.2초) */
export const SURVEY_DELAY_MS = 1200;

/** 이 회원이 이 회차 설문을 이미 봤는지 적어 두는 브라우저 저장소 키(같은 브라우저의 다른 회원과 나눈다) */
export const surveySeenKey = (userId: number, round: number) =>
  `hankkeut:survey:${userId}:${round}`;

/**
 * 설문 주소. 주소의 {userId} · {streak} 자리에 회원 id와 스트릭 일수를 넣는다(구글폼 미리 채우기 entry 번호는 폼마다 달라
 * 주소에 자리 표시로 적어 둔다. 예: …/viewform?entry.111={userId}&entry.222={streak}).
 */
export function surveyLink(template: string, userId: number, streak: number): string {
  return template
    .replaceAll("{userId}", encodeURIComponent(String(userId)))
    .replaceAll("{streak}", encodeURIComponent(String(streak)));
}

function seen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function markSeen(key: string, answer: "joined" | "later") {
  try {
    localStorage.setItem(key, answer);
  } catch {
    // 저장소를 못 쓰면(사생활 보호 모드 등) 기록 없이 넘어간다.
  }
}

/** S08-B 설문 유도 모달. round(3 · 7 · 21일째)마다 한 번만 띄운다 */
export function SurveyModal({
  round,
  surveyUrl,
  userId,
}: {
  round: number;
  surveyUrl: string;
  userId: number;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const showToast = useToastStore((state) => state.show);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const joined = useRef(false);
  const key = surveySeenKey(userId, round);
  useLockScroll(open);

  useEffect(() => {
    if (seen(key)) return;
    const timer = setTimeout(() => setOpen(true), SURVEY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key]);

  // 설문 탭에서 돌아오면 고마움을 전한다.
  useEffect(() => {
    function back() {
      if (document.visibilityState !== "visible" || !joined.current) return;
      joined.current = false;
      showToast({ text: "고마워요!" });
    }
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [showToast]);

  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>("button")?.focus();
  }, [open]);

  function close() {
    markSeen(key, "later");
    setOpen(false);
  }

  function join() {
    window.open(surveyLink(surveyUrl, userId, round), "_blank", "noopener,noreferrer");
    markSeen(key, "joined");
    joined.current = true;
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="survey"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(25,33,40,0.5)] px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.25 }}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
            if (event.key !== "Tab") return;
            // 모달 안에서만 Tab이 돈다.
            const items = dialog.current?.querySelectorAll<HTMLElement>("button");
            if (!items?.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative flex w-full max-w-[520px] flex-col items-center gap-4 rounded-[28px] bg-bg-sub p-9 shadow-[0_20px_24px_rgba(25,33,40,0.25)]"
            initial={reduce ? false : { y: 32 }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            <button
              type="button"
              aria-label="닫기"
              onClick={close}
              className="absolute top-6 right-8 flex cursor-pointer"
            >
              <MaskIcon src="/review/icon-x.svg" size={22} className="bg-text-3" />
            </button>
            <motion.span
              aria-hidden
              className="flex size-20 items-center justify-center rounded-3xl bg-brand-soft dark:bg-brand-soft/8"
              initial={reduce ? false : { rotate: -8, scale: 0.8 }}
              animate={{ rotate: [-8, 8, 0], scale: [0.8, 1.1, 1] }}
              transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
            >
              <MaskIcon
                src="/review/icon-message-circle-heart.svg"
                size={40}
                className="bg-brand-ink"
              />
            </motion.span>
            <h2
              id={titleId}
              className="text-center text-[26px] leading-normal font-extrabold tracking-[-0.2px] text-text-1"
            >
              1분만 의견을 들려주세요
            </h2>
            <p className="max-w-[440px] text-center text-base leading-[1.6] font-medium tracking-[-0.2px] break-keep text-text-2">
              {round}일 동안 연습해보니 어땠나요?
              <br />
              여러분 의견으로 한끗이 더 좋아져요
            </p>
            <p className="flex items-center gap-1 rounded-full bg-bg-sub px-3.5 py-2 text-[13px] leading-normal font-bold tracking-[-0.2px] text-text-2">
              <MaskIcon src="/review/icon-timer.svg" size={13} className="bg-current" />
              질문 5개 · 약 1분
            </p>
            <div className="flex w-full gap-2.5 pt-2">
              <button
                type="button"
                onClick={close}
                className="flex h-14 flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-surface px-6 text-base leading-normal font-bold tracking-[-0.2px] text-text-1"
              >
                다음에 할게요
              </button>
              <button
                type="button"
                onClick={join}
                className="flex h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-brand-strong px-6 text-base leading-normal font-bold tracking-[-0.2px] text-white"
              >
                설문 참여하기
                <MaskIcon src="/review/icon-external-link.svg" size={18} className="bg-white" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
