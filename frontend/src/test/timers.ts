import { vi } from "vitest";

/**
 * 정리(cleanup) 테스트용: 검증 대상이 건 타이머가 풀렸는지 본다.
 * `vi.getTimerCount()`는 React · 라이브러리가 건 타이머까지 세어 실행 순서에 따라 달라지므로 쓰지 않는다.
 * 사용: `vi.useFakeTimers()` 다음에 `const timers = spyTimers()`, 그린 뒤 정리하고
 * `expect(timers.cleared("timeout", 30_000)).toBe(true)`처럼 간격으로 그 타이머를 골라 확인한다.
 * spy는 설정(restoreMocks)이 테스트마다 되돌린다.
 */
export function spyTimers() {
  const pairs = {
    timeout: [vi.spyOn(globalThis, "setTimeout"), vi.spyOn(globalThis, "clearTimeout")],
    interval: [vi.spyOn(globalThis, "setInterval"), vi.spyOn(globalThis, "clearInterval")],
  } as const;

  /** 간격이 ms인 그 종류의 타이머를 하나 이상 걸었고, 건 것이 모두 풀렸으면 true */
  function cleared(kind: keyof typeof pairs, ms: number) {
    const [create, clear] = pairs[kind];
    const ids = create.mock.calls.flatMap((args, index) =>
      args[1] === ms ? [create.mock.results[index]?.value] : [],
    );
    const clearedIds = new Set(clear.mock.calls.map(([id]) => id));
    return ids.length > 0 && ids.every((id) => clearedIds.has(id));
  }

  return { cleared };
}
