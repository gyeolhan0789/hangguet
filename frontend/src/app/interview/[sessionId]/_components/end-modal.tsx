"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import { endSession } from "@/lib/interview/actions";
import { gazeRatio } from "@/lib/interview/gaze";
import { TOTAL_QUESTIONS } from "@/lib/interview/questions";
import { useGazeStore } from "@/stores/gaze-store";
import { useInterviewStore } from "@/stores/interview-store";

import { useSaveConfirmed } from "./use-save-confirmed";

// 기준: Figma S06-E 면접 종료 확인(18:4226: Dim rgba(11,13,20,.65) · Modal 440 · 흰색 · 둥글기 24 · 패딩 32 · 간격 16
// · 그림자 0 20 24 rgba(25,33,40,.25) · Icon Tile 56(#f2f4f6 · 둥글기 20 · door-open 28) · '면접을 끝낼까요?' 24 ExtraBold #191f28
// · '지금 끝내면 답변한 2개 질문까지만 / 결과가 나와요' 15 Medium #4e5968 · Streak Info(#eaf8f1 · flame 14 · '오늘 스트릭은 인정돼요' 13 Bold #1fb57a)
// · 버튼 높이 52 · 둥글기 14 · 간격 10 · 위 8: [끝내기](#f2f4f6 · 16 Bold #f04452) · [계속하기](brand-strong · 16 Bold 흰색))
// · 기획 메모 S06-E(18:3508: 안전한 쪽(계속하기)을 강조, 끝내기 → S06-1, 답변 0개면 '결과 없이 나가요' 문구 + 스트릭 미인정)
// · 모션 메모 S06-E(18:4318: 배경 dim 페이드 + 모달 팝, 답변 0개일 때는 '결과 없이 나가요 · 스트릭 미인정' 문구로 교체)
// · 웹 Swagger 5.8 면접 끝내기(답변이 1개 이상이면 결과 분석 시작, 없으면 결과 없이 끝남)
// · API 명세 5.8 「직전 답변 저장 확인」(화상: 제출됨을 받은 답변이 5.2 answeredCount에 보일 때까지, 최대 10초 기다린 뒤 5.8.
//   기다리는 동안 답변을 저장하는 중임을 안내한다) · S15P31A301-257
// S06 계열은 라이트 · 다크 구분 없는 화면이라, 모달 색은 테마에 따라 바뀌는 토큰 대신 Figma 값을 그대로 쓴다.

/** S06-E 면접 종료 확인 모달 */
export function EndModal({
  sessionId,
  answeredCount,
  video,
}: {
  sessionId: number;
  answeredCount: number;
  /** 화상 면접. 마지막 답변 뒤 면접 화면이 5.8을 보내고 실패해도 다시 보낸다 */
  video: boolean;
}) {
  const reduce = useReducedMotion();
  const open = useInterviewStore((state) => state.endOpen);
  const closeEnd = useInterviewStore((state) => state.closeEnd);
  const setLeveledUp = useInterviewStore((state) => state.setLeveledUp);
  const [pending, startEnd] = useTransition();
  const [error, setError] = useState<string>();
  // 시선 비율은 키를 만들 때 정해 같은 키로는 같은 값을 보낸다(본문이 다르면 409 IDEMPOTENCY_KEY_REUSED, API 명세 5.8). 채팅은 재지 않는다
  const key = useRef<{ value: string; gazeRatio: number | null } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // 화상에서 제출됨을 받은 답변이 아직 answeredCount에 보이지 않으면, [끝내기] 뒤 저장을 확인하고(최대 10초) 끝낸다.
  // 채팅은 5.7 응답으로 저장을 확인했으므로 기다리지 않는다(submittedSeq를 쓰지 않는다).
  const submittedSeq = useInterviewStore((state) => state.submittedSeq);
  const unsaved = submittedSeq !== null && answeredCount < submittedSeq;
  // 화상: 마지막(5번째) 답변이 제출됐거나 5개가 저장됐으면 면접 화면이 스스로 끝낸다(5.8, 실패하면 다시 보낸다). 모달은 저장 중임만
  // 알리고(화면이 결과 분석으로 넘어갈 때까지) 보내지 않는다(두 번 보내지 않게). 채팅의 마지막 5.8은 다시 보내지 않으므로 모달이 보낸다.
  const autoEnding =
    video && (submittedSeq === TOTAL_QUESTIONS || answeredCount >= TOTAL_QUESTIONS);
  const [confirming, setConfirming] = useState(false);
  const confirmed = useSaveConfirmed(confirming, !unsaved);
  const saving = confirming && (!confirmed || autoEnding);
  const busy = pending || saving;
  const sentAfterConfirm = useRef(false);
  // 기다리는 동안 면접 화면이 5.2를 2초마다 다시 부르게 알린다
  const setConfirmingSave = useInterviewStore((state) => state.setConfirmingSave);
  useEffect(() => {
    setConfirmingSave(saving);
    return () => setConfirmingSave(false);
  }, [saving, setConfirmingSave]);
  // 기다리거나 보내는 동안 버튼이 막혀 빠진 포커스를, 다시 누를 수 있게 되면 [계속하기]로 되돌린다(Esc · Tab이 모달에서 듣도록)
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && open) keep.current?.focus();
    wasBusy.current = busy;
  }, [busy, open]);

  // 열리면 안전한 쪽([계속하기])에 포커스를 둔다.
  useEffect(() => {
    if (open) keep.current?.focus();
  }, [open]);

  function close() {
    setError(undefined);
    setConfirming(false);
    sentAfterConfirm.current = false;
    closeEnd();
  }

  function send() {
    key.current ??= {
      value: crypto.randomUUID(),
      gazeRatio: video ? gazeRatio(useGazeStore.getState().frames) : null,
    };
    const { value, gazeRatio: ratio } = key.current;
    startEnd(async () => {
      const result = await endSession(sessionId, value, ratio);
      if (result.keySpent) key.current = null;
      if (result.formError) setError(result.formError);
      else {
        setLeveledUp(result.leveledUp ?? null);
        close();
      }
    });
  }

  function end() {
    setError(undefined);
    if (autoEnding || (unsaved && !confirmed)) {
      setConfirming(true);
      return;
    }
    send();
  }

  // 저장이 보이거나 기다리는 시간이 지나면 한 번 끝낸다
  const sendConfirmed = useEffectEvent(() => send());
  useEffect(() => {
    if (!confirmed || sentAfterConfirm.current || autoEnding) return;
    sentAfterConfirm.current = true;
    sendConfirmed();
  }, [confirmed, autoEnding]);

  // Esc로 닫고, 모달 안에서만 Tab이 돈다(aria-modal). 끝내는 중에는 닫지 않는다.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
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
                disabled={busy}
                aria-busy={busy || undefined}
                className="flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-[#f2f4f6] px-6 text-base leading-normal font-bold text-[#f04452] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f04452] disabled:cursor-wait"
              >
                끝내기
              </button>
              <button
                ref={keep}
                type="button"
                onClick={close}
                disabled={busy}
                className="flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] bg-brand-strong px-6 text-base leading-normal font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-strong disabled:cursor-not-allowed"
              >
                계속하기
              </button>
            </div>
            {saving && (
              <p
                role="status"
                className="text-center text-[13px] leading-normal font-medium text-[#4e5968]"
              >
                답변을 저장하는 중이에요
              </p>
            )}
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
