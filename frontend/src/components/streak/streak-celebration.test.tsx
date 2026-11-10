import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StreakCelebration } from "./streak-celebration";

// 불 전환 연출 시간을 기다리지 않도록 '동작 줄이기' 상태로 그린다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));

// vitest 전역 모드가 아니라 테스트마다 직접 정리한다.
afterEach(cleanup);

// 면접을 마친 화면(S08 흐름)은 아직 없어서, 그 화면이 띄울 연출을 컴포넌트로 확인한다.
describe("StreakCelebration (면접을 마친 순간)", () => {
  it("'N일째 달성!'을 보여 주고, 단계가 그대로면 레벨업 없이 끝난다", async () => {
    const onDone = vi.fn();
    render(<StreakCelebration days={7} leveledUp={false} onDone={onDone} />);

    expect(screen.getByRole("status").textContent).toBe(
      "7일째 달성! 오늘도 해냈어요 — 내일 또 만나요",
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // 'N일째 달성!' → 레벨업 순서는 streak-celebration.motion.test.tsx가 실제 연출로 확인한다.
  it("단계가 올랐으면 S02-L 레벨업을 띄우고, [계속하기]를 눌러야 끝난다", async () => {
    const onDone = vi.fn();
    render(<StreakCelebration days={8} leveledUp onDone={onDone} />);

    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("status")).toBeNull();
    expect(dialog.textContent).toContain("푸른 불꽃");
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "계속하기" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
