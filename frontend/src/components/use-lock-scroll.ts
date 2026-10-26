"use client";

import { useEffect } from "react";

// 지금 잠그고 있는 곳의 수. 여러 곳(햄버거 메뉴 · 공지 모달 등)이 겹쳐 잠가도 연 순서와 상관없이 마지막 하나가 풀릴 때만 되돌린다.
let locks = 0;
let previous = "";

/** 전체 화면 연출(인트로·레벨업) · 모달 · 메뉴가 떠 있는 동안 뒤 페이지가 스크롤되지 않게 막는다. */
export function useLockScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    if (locks === 0) {
      previous = root.style.overflow;
      root.style.overflow = "hidden";
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) root.style.overflow = previous;
    };
  }, [locked]);
}
