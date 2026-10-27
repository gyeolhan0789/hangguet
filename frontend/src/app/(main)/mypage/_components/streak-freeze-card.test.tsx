import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Toast } from "@/components/toast";
import type { MyStreakFreezesResponse } from "@/types/api";

import { StreakFreezeCard } from "./streak-freeze-card";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
}));
// 열림 · 닫힘 애니메이션을 건너뛰어 실제 시간을 기다리지 않는다
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

// 서버 액션 경계만 바꾼다. 실제 메우기 · 다시 그리기는 E2E(notice-streak-freeze.spec.ts)가 본다.
const applyStreakFreeze = vi.fn();
vi.mock("@/lib/user/actions", () => ({
  applyStreakFreeze: (...args: unknown[]) => applyStreakFreeze(...args),
}));

// 기준: Figma S09 스트릭 유지권 박스 · S09-2 · S09-3 · 기획 메모 S09 · S09-2 · S09-3 · Swagger 8.13 '2개 있음' 예시 · 8.14

const FREEZES = {
  availableCount: 2,
  freezes: [
    {
      id: 31,
      fillableDate: "2026-10-19",
      grantedAt: "2026-10-20T00:00:00+09:00",
      expiresAt: "2026-11-03T00:00:00+09:00",
    },
    {
      id: 32,
      fillableDate: "2026-10-22",
      grantedAt: "2026-10-23T00:00:00+09:00",
      expiresAt: "2026-11-06T00:00:00+09:00",
    },
  ],
} satisfies MyStreakFreezesResponse;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCard(freezes: MyStreakFreezesResponse = FREEZES) {
  render(
    <>
      <StreakFreezeCard freezes={freezes} />
      <Toast />
    </>,
  );
}

const card = () => screen.getByRole("region", { name: "스트릭 유지권" });

describe("StreakFreezeCard (S09 스트릭 유지권)", () => {
  it("소유한 개수와 유지권마다 메울 날짜 · 만료 날짜 · [메우기]를 보여 준다", () => {
    renderCard();

    expect(card().textContent).toContain("소유한 유지권 2개");
    expect(screen.getByText("10월 19일")).toBeTruthy();
    expect(screen.getByText("11.03까지")).toBeTruthy();
    expect(screen.getByText("10월 22일")).toBeTruthy();
    expect(screen.getByText("11.06까지")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "메우기" })).toHaveLength(2);
  });

  it("유지권이 없으면 '아직 받은 유지권이 없어요'만 보여 준다", () => {
    renderCard({ availableCount: 0, freezes: [] });

    expect(screen.getByText("아직 받은 유지권이 없어요")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "메우기" })).toBeNull();
  });

  it("[메우기] → 그 유지권의 날짜로 확인 모달(S09-2), [취소] · Esc로 닫힌다", async () => {
    renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: "메우기" })[1]);
    const dialog = screen.getByRole("dialog", { name: "스트릭 유지권을 사용하시겠습니까?" });
    expect(dialog.textContent).toContain("날짜 : 2026.10.22");

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getAllByRole("button", { name: "메우기" })[0]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(applyStreakFreeze).not.toHaveBeenCalled();
  });

  it("모달의 [메우기] → 8.14로 그 유지권을 쓰고, 성공하면 '유지권 사용 완료!'(S09-3) → [확인]으로 닫힌다", async () => {
    applyStreakFreeze.mockResolvedValue({
      used: { practiceDate: "2026-10-19", freezeId: 31, availableCount: 1, currentStreak: 9 },
    });
    renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: "메우기" })[0]);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "메우기" }));
    });

    expect(applyStreakFreeze).toHaveBeenCalledWith(31);
    const done = await screen.findByRole("dialog", { name: "유지권 사용 완료!" });
    expect(done.textContent).not.toContain("날짜 :");

    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("실패하면(409 등) 모달을 닫고 서버 문구를 토스트로 알린다", async () => {
    applyStreakFreeze.mockResolvedValue({ error: "이미 연습한 날이라 메울 수 없어요." });
    renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: "메우기" })[0]);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "메우기" }));
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("이미 연습한 날이라 메울 수 없어요.");
  });

  it("메우는 동안에는 [취소] · [메우기]를 누를 수 없고 Esc로도 닫히지 않는다", async () => {
    let resolve: (value: unknown) => void = () => {};
    applyStreakFreeze.mockReturnValue(new Promise((r) => (resolve = r)));
    renderCard();

    fireEvent.click(screen.getAllByRole("button", { name: "메우기" })[0]);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "메우기" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(
        true,
      ),
    );
    expect(within(dialog).getByRole("button", { name: "메우기" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () =>
      resolve({
        used: { practiceDate: "2026-10-19", freezeId: 31, availableCount: 1, currentStreak: 9 },
      }),
    );
    expect(await screen.findByRole("dialog", { name: "유지권 사용 완료!" })).toBeTruthy();
  });
});
