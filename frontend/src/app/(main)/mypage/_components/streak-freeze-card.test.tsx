// 기준: Figma S09 스트릭 유지권 박스(18:3075) · S09-2 사용 확인 모달(265:1314) · S09-3 사용 완료 모달(266:1553)
// · Swagger 8.13 내 스트릭 유지권(MyStreakFreezesResponse) · 8.14 유지권 사용 · 기획 메모 S09 · S09-2 · S09-3
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyStreakFreeze } from "@/lib/user/actions";
import { useToastStore } from "@/stores/toast-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { MyStreakFreezesResponse, StreakFreezeUseResponse } from "@/types/api";

import { StreakFreezeCard } from "./streak-freeze-card";

// 경계 mock: 서버 액션(8.14)과 연출(motion)
vi.mock("@/lib/user/actions", () => ({ applyStreakFreeze: vi.fn() }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 8.13 '2개 있음' 예시 · 8.14 200 예시
const FREEZES: MyStreakFreezesResponse = {
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
};
const USED: StreakFreezeUseResponse = {
  practiceDate: "2026-10-19",
  freezeId: 31,
  availableCount: 1,
  currentStreak: 9,
};
const CONFIRM_TITLE = "스트릭 유지권을 사용하시겠습니까?";

/** 유지권 줄의 [메우기](n번째) */
const rowFill = (index: number) => screen.getAllByRole("button", { name: "메우기" })[index];
const dialog = () => screen.queryByRole("dialog");
/** 모달 안 버튼 */
const modalButton = (name: string) =>
  within(screen.getByRole("dialog")).getByRole("button", { name });

/** 첫 유지권으로 확인 모달을 연다 */
function openFirst() {
  render(<StreakFreezeCard freezes={FREEZES} />);
  fireEvent.click(rowFill(0));
}

/** 첫 유지권을 써서 사용 완료 화면까지 간다 */
async function useFirst() {
  vi.mocked(applyStreakFreeze).mockResolvedValue({ used: USED });
  openFirst();
  fireEvent.click(modalButton("메우기"));
  await flushPromises();
}

beforeEach(() => {
  useToastStore.setState({ toast: null });
});

describe("StreakFreezeCard · 스트릭 유지권", () => {
  describe("유지권 목록", () => {
    describe("화면 표시", () => {
      it("유지권이 없으면 '아직 받은 유지권이 없어요'만 보여 준다", () => {
        render(<StreakFreezeCard freezes={{ availableCount: 0, freezes: [] }} />);

        expect(screen.getByText("아직 받은 유지권이 없어요")).toBeDefined();
        expect(screen.queryByText(/소유한 유지권/)).toBeNull();
        expect(screen.queryByRole("button", { name: "메우기" })).toBeNull();
      });

      it("유지권이 있으면 쓸 수 있는 개수를 '소유한 유지권 N개'로 보여 준다", () => {
        render(<StreakFreezeCard freezes={FREEZES} />);

        expect(screen.getByText("소유한 유지권", { exact: false }).textContent).toBe(
          "소유한 유지권 2개",
        );
      });

      it("유지권마다 메울 날짜를 'M월 D일', 만료를 'MM.DD까지'로 보여 준다", () => {
        render(<StreakFreezeCard freezes={FREEZES} />);

        const rows = screen.getAllByRole("listitem").map((row) => row.textContent);
        expect(rows[0]).toContain("10월 19일");
        expect(rows[0]).toContain("11.03까지");
        expect(rows[1]).toContain("10월 22일");
        expect(rows[1]).toContain("11.06까지");
      });
    });
  });

  describe("사용 확인 모달", () => {
    describe("사용자 조작", () => {
      it("[메우기]를 누르면 그 유지권의 날짜로 확인 모달을 연다", () => {
        render(<StreakFreezeCard freezes={FREEZES} />);

        fireEvent.click(rowFill(1));

        expect(screen.getByRole("dialog", { name: CONFIRM_TITLE }).textContent).toContain(
          "날짜 : 2026.10.22",
        );
      });

      it("[취소]를 누르면 모달을 닫는다", () => {
        openFirst();

        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(dialog()).toBeNull();
      });

      it("Esc를 누르면 모달을 닫는다", () => {
        openFirst();

        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(dialog()).toBeNull();
      });

      it("사용 완료 화면에서 [확인]을 누르면 모달을 닫는다", async () => {
        await useFirst();

        fireEvent.click(screen.getByRole("button", { name: "확인" }));

        expect(dialog()).toBeNull();
      });

      it("사용 완료 화면에서는 Esc로 닫지 않는다", async () => {
        await useFirst();

        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(screen.getByRole("dialog", { name: "유지권 사용 완료!" })).toBeDefined();
      });
    });

    describe("정상 처리", () => {
      it("모달의 [메우기]로 그 유지권을 쓰면 '유지권 사용 완료!'를 보여 준다", async () => {
        await useFirst();

        expect(applyStreakFreeze).toHaveBeenCalledWith(31);
        expect(screen.getByRole("dialog", { name: "유지권 사용 완료!" })).toBeDefined();
      });
    });

    describe("상태 변화", () => {
      it("사용 완료 뒤 닫고 다른 유지권을 열면 확인 화면부터 보여 준다", async () => {
        await useFirst();
        fireEvent.click(screen.getByRole("button", { name: "확인" }));

        fireEvent.click(rowFill(1));

        expect(screen.getByRole("dialog", { name: CONFIRM_TITLE }).textContent).toContain(
          "날짜 : 2026.10.22",
        );
      });
    });

    describe("오류 처리", () => {
      it("쓰지 못하면 모달을 닫고 서버 문구를 토스트로 알린다", async () => {
        vi.mocked(applyStreakFreeze).mockResolvedValue({
          error: "이미 연습한 날이라 메울 수 없어요.",
        });
        openFirst();

        fireEvent.click(modalButton("메우기"));
        await flushPromises();

        expect(dialog()).toBeNull();
        expect(useToastStore.getState().toast?.text).toBe("이미 연습한 날이라 메울 수 없어요.");
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("메우는 동안에는 두 버튼을 누를 수 없고 Esc로도 닫지 않는다", async () => {
        const response = deferred<{ used: StreakFreezeUseResponse }>();
        vi.mocked(applyStreakFreeze).mockReturnValue(response.promise);
        openFirst();

        fireEvent.click(modalButton("메우기"));
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        expect(modalButton("메우기").hasAttribute("disabled")).toBe(true);
        expect(modalButton("취소").hasAttribute("disabled")).toBe(true);
        expect(screen.getByRole("dialog", { name: CONFIRM_TITLE })).toBeDefined();
        await act(async () => response.resolve({ used: USED }));
      });
    });
  });
});
