import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StreakCelebration } from "./streak-celebration";

// vitest 전역 모드가 아니라 테스트마다 직접 정리한다.
afterEach(cleanup);

// '동작 줄이기' 없이 실제 불 전환(약 3초)을 끝까지 돌려, 연출 순서대로 다음 단계로 넘어가는지 본다.
describe("StreakCelebration 실제 연출", () => {
  it("숫자가 N-1 → N으로 바뀐 뒤, 단계가 올랐으면 레벨업으로 이어진다", async () => {
    const onDone = vi.fn();
    render(<StreakCelebration days={8} leveledUp onDone={onDone} />);

    // 보조기기에는 바뀐 뒤의 문구를 처음부터 읽어 주고, 화면의 큰 글씨만 N-1 → N으로 굴러 바뀐다
    expect(screen.getByRole("status").textContent).toContain("8일째 달성!");
    const badge = screen.getByTestId("streak-badge");
    expect(badge.textContent).toContain("7일째 달성!");

    await waitFor(() => expect(badge.textContent).toContain("8일째 달성!"), { timeout: 4_000 });
    expect(await screen.findByRole("dialog", {}, { timeout: 4_000 })).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  }, 10_000);

  it("단계가 그대로면 불 전환이 걷힌 뒤 끝난다", async () => {
    const onDone = vi.fn();
    render(<StreakCelebration days={7} leveledUp={false} onDone={onDone} />);

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce(), { timeout: 6_000 });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  }, 10_000);
});
