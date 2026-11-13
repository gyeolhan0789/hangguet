"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { Spinner } from "@/components/spinner";
import type { CheckStatus } from "@/lib/devices/media";

import type { NetworkStatus } from "./use-device-check";

// 기준: Figma S05 Check 카메라 · 마이크 · 스피커 · 네트워크(18:2423 · 18:2434 · 18:2446 · 18:2459: 흰 줄 · 40px 타일
// · 제목 16 Bold · 설명 14 Medium text-3 · 오른쪽 circle-check 24 또는 [들어보기]) · S05-E 실패 줄(18:4103: danger-soft 배경
// · danger 테두리 · 설명 danger · circle-x) · 모션 메모 S05(18:2492: 스피너 → 초록 체크 scale 0.6→1 spring, 권한 거부 시 빨간 테두리 + 흔들림)

export type RowState = "checking" | "ok" | "fail";

/** 점검 상태를 줄 상태로: 확인 중 · 됨 · 그 밖은 실패 */
export function toRowState(status: CheckStatus | NetworkStatus): RowState {
  if (status === "checking") return "checking";
  return status === "ok" ? "ok" : "fail";
}

/** 장치 점검 체크 줄 하나. action이 있으면 오른쪽 상태 아이콘 대신 버튼을 둔다. */
export function CheckRow({
  icon,
  title,
  description,
  state,
  action,
}: Readonly<{
  /** 타일 아이콘(20px) */
  icon: string;
  title: string;
  description: string;
  state: RowState;
  action?: ReactNode;
}>) {
  const [scope, animate] = useAnimate<HTMLLIElement>();
  const reduce = useReducedMotion();
  const failed = state === "fail";
  const wasFailed = useRef(failed);

  // 실패로 바뀌는 순간 한 번 흔든다.
  useEffect(() => {
    if (failed && !wasFailed.current && !reduce && scope.current) {
      animate(scope.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4 });
    }
    wasFailed.current = failed;
  }, [failed, reduce, animate, scope]);

  return (
    <li
      ref={scope}
      className={`flex items-center gap-3.5 rounded-2xl px-4 py-3.5 transition-[background-color,box-shadow] duration-300 ${
        failed ? "bg-danger-soft ring-1 ring-danger ring-inset dark:bg-danger-soft/14" : "bg-bg-sub"
      }`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bg-sub">
        <MaskIcon src={icon} size={20} className="bg-text-2" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-normal tracking-[-0.2px]">
        <span className="text-base leading-normal font-bold text-text-1">{title}</span>
        <span
          className={`text-sm leading-normal font-medium ${failed ? "text-danger" : "text-text-3"}`}
        >
          {description}
        </span>
      </span>
      {action ?? <StatusIcon state={state} />}
    </li>
  );
}

function StatusIcon({ state }: Readonly<{ state: RowState }>) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {state === "checking" ? (
          <motion.span key="checking" exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            <Spinner size={20} className="bg-text-3" />
            <span className="sr-only">확인 중</span>
          </motion.span>
        ) : (
          <motion.span
            key={state}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            className="flex"
          >
            <MaskIcon
              src={state === "ok" ? "/devices/icon-circle-check.svg" : "/devices/icon-circle-x.svg"}
              size={24}
              className={state === "ok" ? "bg-success" : "bg-danger"}
            />
            <span className="sr-only">{state === "ok" ? "확인됨" : "확인 안 됨"}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** 체크 줄 오른쪽 작은 버튼(Figma Button 들어보기 18:2455: 높이 36 · 둥글기 10 · 14 Bold · 아이콘 14) */
export function RowButton({
  icon,
  children,
  label,
  onClick,
  disabled = false,
  pending = false,
}: Readonly<{
  icon: string;
  /** 버튼 글자. 없으면 아이콘만 보이는 정사각형 버튼이고 label이 이름이 된다 */
  children?: ReactNode;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      aria-label={label}
      className={`flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-bg-sub text-sm leading-normal font-bold tracking-[-0.2px] text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:text-text-3 ${
        children ? "px-3.5" : "w-9"
      }`}
    >
      {pending ? (
        <Spinner size={14} className="bg-text-3" />
      ) : (
        <MaskIcon src={icon} size={14} className={disabled ? "bg-text-3" : "bg-text-1"} />
      )}
      {children}
    </button>
  );
}
