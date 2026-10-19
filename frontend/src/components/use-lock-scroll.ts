"use client";

import { useEffect } from "react";

/** 전체 화면 연출(인트로·레벨업)이 떠 있는 동안 뒤 페이지가 스크롤되지 않게 막는다. */
export function useLockScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [locked]);
}
