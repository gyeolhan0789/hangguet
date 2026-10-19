"use client";

import { motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

/** 폼 제출 버튼. 비활성 → 활성으로 바뀌는 순간 살짝 튀어 누를 수 있게 됐음을 알린다. */
export function SubmitButton({
  children,
  pendingText,
  pending = false,
  disabled = false,
  height = "h-14",
}: {
  children: ReactNode;
  pendingText: string;
  pending?: boolean;
  disabled?: boolean;
  height?: string;
}) {
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const reduce = useReducedMotion();
  const wasDisabled = useRef(disabled);

  useEffect(() => {
    if (wasDisabled.current && !disabled && !reduce && scope.current) {
      animate(scope.current, { scale: [1, 1.04, 1] }, { duration: 0.3 });
    }
    wasDisabled.current = disabled;
  }, [disabled, reduce, animate, scope]);

  return (
    <motion.button
      ref={scope}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`flex w-full cursor-pointer items-center justify-center rounded-[14px] bg-brand-strong px-6 text-[17px] leading-normal font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40 ${height}`}
    >
      {pending ? pendingText : children}
    </motion.button>
  );
}
