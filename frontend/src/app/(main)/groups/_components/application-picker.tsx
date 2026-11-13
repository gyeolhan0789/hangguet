"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { ApplicationRadioList } from "@/components/application/application-radio-list";
import { cycleTabFocus } from "@/components/cycle-tab-focus";
import { useLockScroll } from "@/components/use-lock-scroll";
import { applicationNewPath } from "@/lib/routes";
import type { ApplicationListItem } from "@/types/api";

// 기준: Figma [초안] G02 '내 지원서'(484:2500: bg-sub · 1px line 테두리 · 둥글기 12 · 여백 16 · 14, '회사 · 직무 (내 지원서)' 15 Medium
// · 오른쪽 '변경' 13 Bold text-3) · G03 '내 지원서'(484:2552)
// · 사용자 결정(2026-11-13: [변경]은 모달로 열고, 모달 안 목록은 S03 지원서 선택과 같은 UI를 쓴다. 모달은 화면 안에 두고 목록만 스크롤)
// 모달 틀은 설정 화면 모달(settings-dialog.tsx: dim · 둥글기 24 · 패딩 32 · Esc · dim으로 닫힘 · 안에서만 Tab)과 같다.
// 열면 고른 지원서(없으면 첫 지원서)에 포커스를 두고, 닫으면 [변경] 칸으로 포커스를 돌려준다(권한 모달 · 설정 모달과 같은 방식).

const dialogButton =
  "flex h-[52px] flex-1 cursor-pointer items-center justify-center rounded-[14px] text-base leading-normal font-bold tracking-[-0.2px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60";

export function ApplicationPicker({
  applications,
  value,
  onChange,
}: Readonly<{
  applications: readonly ApplicationListItem[];
  value: number | null;
  onChange: (applicationId: number) => void;
}>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const valueId = useId();
  const actionId = useId();
  const current = applications.find((item) => item.id === value);
  // [+ 추가하기]는 S03과 같은 지원서 쓰기로 간다(저장 뒤 S03으로 돌아간다 · 사용자 결정 2026-10-29)
  const addHref = applicationNewPath("practice");

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span id={labelId} className="text-sm leading-normal font-bold text-text-1">
        내 지원서
      </span>
      {applications.length === 0 ? (
        <p className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-sub px-4 py-3.5 text-[15px] leading-normal font-medium text-text-3">
          저장된 지원서가 없어요
          <Link
            href={addHref}
            className="shrink-0 rounded text-[13px] font-bold text-brand-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            + 추가하기
          </Link>
        </p>
      ) : (
        <button
          ref={trigger}
          type="button"
          aria-labelledby={`${labelId} ${valueId} ${actionId}`}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-bg-sub px-4 py-3.5 text-left transition-colors hover:border-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <span
            id={valueId}
            className="truncate text-[15px] leading-normal font-medium text-text-1"
          >
            {current
              ? `${current.companyName} · ${current.jobTitle} (내 지원서)`
              : "지원서를 골라 주세요"}
          </span>
          <span id={actionId} className="shrink-0 text-[13px] leading-normal font-bold text-text-3">
            변경
          </span>
        </button>
      )}
      <PickerModal
        open={open}
        applications={applications}
        value={value}
        addHref={addHref}
        onClose={close}
        onPick={(applicationId) => {
          onChange(applicationId);
          close();
        }}
      />
    </div>
  );
}

/** 지원서 고르기 모달. 고른 값은 [선택]을 눌러야 반영한다 */
function PickerModal({
  open,
  applications,
  value,
  addHref,
  onClose,
  onPick,
}: Readonly<{
  open: boolean;
  applications: readonly ApplicationListItem[];
  value: number | null;
  addHref: string;
  onClose: () => void;
  onPick: (applicationId: number) => void;
}>) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLockScroll(open);
  // 모달을 열 때마다 지금 고른 지원서에서 시작한다
  const [draft, setDraft] = useState(value);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(value);
  }
  // 열리면 고른 지원서(없으면 첫 지원서)로 포커스를 옮긴다. Esc · Tab 가두기는 모달 안에 포커스가 있어야 동작한다.
  useEffect(() => {
    if (!open) return;
    const root = dialog.current;
    const target =
      root?.querySelector<HTMLElement>("input:checked") ??
      root?.querySelector<HTMLElement>("input[type=radio]") ??
      root;
    target?.focus();
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    cycleTabFocus(event, [
      ...dialog.current.querySelectorAll<HTMLElement>(
        "input:checked, a[href], button:not(:disabled)",
      ),
    ]);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="dim"
          // 모달은 화면 안에 고정하고(바깥은 스크롤하지 않는다), 목록만 모달 안에서 위아래로 스크롤한다.
          className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[rgba(25,33,40,0.5)] px-4 py-6 dark:bg-black/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex max-h-full w-full max-w-[560px] flex-col gap-4 rounded-3xl bg-bg-sub p-6 drop-shadow-[0_20px_24px_rgba(25,33,40,0.25)] outline-none sm:p-8 dark:border dark:border-line"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
          >
            <h2
              id={titleId}
              className="text-2xl leading-normal font-extrabold tracking-[-0.2px] text-text-1"
            >
              지원서 선택
            </h2>
            {/* 제목 · 버튼은 늘 보이고 목록만 줄어들며 스크롤한다. 가로로는 움직이지 않는다 */}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
              <ApplicationRadioList
                legend="지원서"
                name="groupApplicationId"
                applications={applications}
                selected={draft}
                onSelect={setDraft}
                addHref={addHref}
                inDialog
              />
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className={`${dialogButton} bg-surface text-text-1`}
              >
                취소
              </button>
              <button
                type="button"
                disabled={draft === null}
                onClick={() => draft !== null && onPick(draft)}
                className={`${dialogButton} bg-brand-strong text-white`}
              >
                선택
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
