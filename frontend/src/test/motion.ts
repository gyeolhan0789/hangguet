import { createElement, Fragment, useEffect, useRef, type ReactNode } from "react";

type MotionModule = typeof import("motion/react");

/**
 * `motion/react` 대역: 연출을 건너뛴다. 사용:
 * `vi.mock("motion/react", async (importOriginal) => (await import("@/test/motion")).reducedMotion(importOriginal))`
 * - useReducedMotion은 true(우리 코드가 연출 없는 분기로 간다)
 * - AnimatePresence는 퇴장 연출 없이 바로 빼고, 자식이 사라지는 순간 onExitComplete를 부른다(motion의 계약과 같게)
 * 연출 순서 자체를 테스트할 때는 쓰지 않는다.
 */
export async function reducedMotion(importOriginal: () => Promise<MotionModule>) {
  const actual = await importOriginal();
  return {
    ...actual,
    useReducedMotion: () => true,
    AnimatePresence: InstantPresence,
  } satisfies Partial<MotionModule>;
}

function InstantPresence({
  children,
  onExitComplete,
}: Readonly<{ children?: ReactNode; onExitComplete?: () => void }>) {
  const hadChildren = useRef(Boolean(children));
  useEffect(() => {
    const has = Boolean(children);
    if (hadChildren.current && !has) onExitComplete?.();
    hadChildren.current = has;
  }, [children, onExitComplete]);
  return createElement(Fragment, null, children);
}
