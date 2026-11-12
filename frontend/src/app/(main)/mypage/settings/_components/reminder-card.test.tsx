// 기준: Figma S09-1 Kakao Reminder(18:3223) · S09-1-B(436:2104) · Swagger 2.8 연습 알림 설정(PracticeAlarmResponse) · 2.9 켜기
// · 2.10 시각 변경 · 2.11 끄기 · 기획 메모 S09-1(available false면 토글 · 시간 비활성) · S09-1-B(428:2146: 오류는 토스트, 토글 · 시각은 그대로)
// · 모션 메모 S09-1(18:3261: 알림 시간 ›는 행에서 인라인 편집)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changePracticeAlarmTime, disablePracticeAlarm, startKakaoAlarm } from "@/lib/user/actions";
import { useToastStore } from "@/stores/toast-store";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import type { PracticeAlarmResponse } from "@/types/api";

import { ReminderCard } from "./reminder-card";

// 경계 mock: 서버 액션(2.9 시작 · 2.10 · 2.11)과 연출(motion)
vi.mock("@/lib/user/actions", () => ({
  startKakaoAlarm: vi.fn(),
  disablePracticeAlarm: vi.fn(),
  changePracticeAlarmTime: vi.fn(),
}));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 2.8 200 예시(카카오 연결 회원 · 꺼짐) 와 켜짐 · 쓸 수 없는 회원
const OFF: PracticeAlarmResponse = { available: true, enabled: false, time: "21:00" };
const ON: PracticeAlarmResponse = { ...OFF, enabled: true };
const UNAVAILABLE: PracticeAlarmResponse = { available: false, enabled: false, time: "21:00" };
const FAILED = "잠시 후 다시 시도해 주세요.";

const toggle = () => screen.getByRole("switch", { name: "카카오톡 연습 알림" });
const timeButton = () => screen.getByRole("button", { name: "알림 시간 매일 21:00, 바꾸기" });
const timeInput = () =>
  screen.queryByLabelText<HTMLInputElement>("알림 시간", { selector: "input" });
const toastText = () => useToastStore.getState().toast?.text;

/** 카카오 동의 화면에서 뒤로 가기로 페이지가 되살아난다(bfcache) */
function restoreFromBfcache() {
  act(() => {
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
}

/** '매일 21:00 ›'을 눌러 시간 편집칸을 연다 */
function renderEditing() {
  render(<ReminderCard alarm={OFF} />);
  fireEvent.click(timeButton());
}

beforeEach(() => {
  useToastStore.setState({ toast: null });
});

describe("ReminderCard · 카카오톡 연습 알림", () => {
  describe("쓸 수 없는 회원", () => {
    describe("화면 표시", () => {
      it("카카오 연결이 없으면 '카카오 연결 필요' 칩과 안내를 보이고 시간 · 토글을 누를 수 없으며 그 이유를 토글 설명으로 읽어 준다", () => {
        render(<ReminderCard alarm={UNAVAILABLE} />);

        expect(screen.getByText("카카오 연결 필요")).toBeDefined();
        expect(screen.queryByRole("button", { name: /알림 시간/ })).toBeNull();
        expect(toggle().hasAttribute("disabled")).toBe(true);
        const describedBy = toggle().getAttribute("aria-describedby") ?? "";
        expect(document.getElementById(describedBy)?.textContent).toBe(
          "카카오 계정 연결이 필요한 기능이에요",
        );
      });
    });
  });

  describe("알림 켜고 끄기", () => {
    describe("화면 표시", () => {
      it("쓸 수 있으면 안내 문구 · '매일 HH:mm' · 켜짐 여부를 토글로 보여 준다", () => {
        render(<ReminderCard alarm={ON} />);

        expect(screen.getByText("연습하지 않았다면 카카오톡으로 알려드릴게요")).toBeDefined();
        expect(screen.queryByText("카카오 연결 필요")).toBeNull();
        expect(timeButton().textContent).toContain("매일 21:00");
        expect(toggle().getAttribute("aria-checked")).toBe("true");
      });
    });

    describe("사용자 조작", () => {
      it("꺼진 토글을 누르면 카카오 메시지 동의를 시작한다", async () => {
        vi.mocked(startKakaoAlarm).mockResolvedValue({});
        render(<ReminderCard alarm={OFF} />);

        fireEvent.click(toggle());
        await flushPromises();

        expect(startKakaoAlarm).toHaveBeenCalledTimes(1);
        expect(disablePracticeAlarm).not.toHaveBeenCalled();
      });

      it("켜진 토글을 누르면 알림을 끈다", async () => {
        vi.mocked(disablePracticeAlarm).mockResolvedValue({});
        render(<ReminderCard alarm={ON} />);

        fireEvent.click(toggle());
        await flushPromises();

        expect(disablePracticeAlarm).toHaveBeenCalledTimes(1);
        expect(startKakaoAlarm).not.toHaveBeenCalled();
      });
    });

    describe("오류 처리", () => {
      it.each([
        { label: "켜기", alarm: OFF, action: startKakaoAlarm, checked: "false" },
        { label: "끄기", alarm: ON, action: disablePracticeAlarm, checked: "true" },
      ])(
        "'$label'에 실패하면 서버 문구를 토스트로 보이고 토글은 그대로 둔다",
        async ({ alarm, action, checked }) => {
          vi.mocked(action).mockResolvedValue({ error: FAILED });
          render(<ReminderCard alarm={alarm} />);

          fireEvent.click(toggle());
          await flushPromises();

          expect(toastText()).toBe(FAILED);
          expect(toggle().getAttribute("aria-checked")).toBe(checked);
          expect(toggle().hasAttribute("disabled")).toBe(false);
        },
      );
    });

    describe("중복 · 경쟁 처리", () => {
      it("처리하는 동안에는 토글을 누를 수 없다", async () => {
        const turningOff = deferred<{ error?: string }>();
        vi.mocked(disablePracticeAlarm).mockReturnValue(turningOff.promise);
        render(<ReminderCard alarm={ON} />);

        fireEvent.click(toggle());
        fireEvent.click(toggle());

        expect(toggle().hasAttribute("disabled")).toBe(true);
        expect(disablePracticeAlarm).toHaveBeenCalledTimes(1);
        await act(async () => turningOff.resolve({}));
      });

      it("카카오 화면에서 뒤로 가기로 되살아나면 토글을 다시 누를 수 있다", async () => {
        const moving = deferred<{ error?: string }>();
        vi.mocked(startKakaoAlarm).mockReturnValue(moving.promise);
        render(<ReminderCard alarm={OFF} />);
        fireEvent.click(toggle());

        restoreFromBfcache();

        expect(toggle().hasAttribute("disabled")).toBe(false);
        await act(async () => moving.resolve({}));
      });
    });

    describe("정리", () => {
      it("언마운트하면 되살아남 감지를 해제한다", () => {
        const add = vi.spyOn(window, "addEventListener");
        const remove = vi.spyOn(window, "removeEventListener");
        const { unmount } = render(<ReminderCard alarm={OFF} />);
        const onPageShow = add.mock.calls.find(([type]) => type === "pageshow")?.[1];

        unmount();

        expect(onPageShow).toBeDefined();
        expect(remove).toHaveBeenCalledWith("pageshow", onPageShow);
      });
    });
  });

  describe("알림 시간 편집", () => {
    describe("사용자 조작", () => {
      it("'매일 HH:mm'을 누르면 지금 시각이 든 편집칸을 연다", () => {
        renderEditing();

        expect(timeInput()?.value).toBe("21:00");
      });

      it("[취소]를 누르면 편집을 닫고 '매일 HH:mm' 버튼으로 포커스를 돌려준다", () => {
        renderEditing();

        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(timeInput()).toBeNull();
        expect(document.activeElement).toBe(timeButton());
      });

      it("고치다 닫고 다시 열면 지금 시각부터 시작한다", () => {
        renderEditing();
        fireEvent.change(timeInput()!, { target: { value: "22:30" } });
        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        fireEvent.click(timeButton());

        expect(timeInput()?.value).toBe("21:00");
      });

      it("Esc를 누르면 편집을 닫는다", () => {
        renderEditing();

        fireEvent.keyDown(timeInput()!, { key: "Escape" });

        expect(timeInput()).toBeNull();
      });
      it("저장되면 편집을 닫는다", async () => {
        vi.mocked(changePracticeAlarmTime).mockResolvedValue({});
        renderEditing();
        fireEvent.change(timeInput()!, { target: { value: "22:30" } });

        fireEvent.click(screen.getByRole("button", { name: "저장" }));
        await flushPromises();

        expect(changePracticeAlarmTime).toHaveBeenCalledTimes(1);
        expect(timeInput()).toBeNull();
      });
    });

    describe("입력 검증", () => {
      it("시각 형식이 틀리면 보내지 않고 칸에 연결된 오류 문구로 알린다", async () => {
        renderEditing();
        fireEvent.change(timeInput()!, { target: { value: "" } });

        fireEvent.click(screen.getByRole("button", { name: "저장" }));
        await flushPromises();

        expect(changePracticeAlarmTime).not.toHaveBeenCalled();
        const describedBy = timeInput()?.getAttribute("aria-describedby") ?? "";
        expect(document.getElementById(describedBy)?.textContent).toBe(
          "HH:mm 형식(00:00~23:59)입니다.",
        );
      });
    });

    describe("오류 처리", () => {
      it("저장이 실패하면 서버 문구를 토스트로 알리고 편집칸은 열어 둔다", async () => {
        vi.mocked(changePracticeAlarmTime).mockResolvedValue({ error: FAILED });
        renderEditing();

        fireEvent.click(screen.getByRole("button", { name: "저장" }));
        await flushPromises();

        expect(toastText()).toBe(FAILED);
        expect(timeInput()).not.toBeNull();
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("저장하는 동안에는 Esc · [취소]로 닫지 않는다", async () => {
        const saving = deferred<{ error?: string }>();
        vi.mocked(changePracticeAlarmTime).mockReturnValue(saving.promise);
        renderEditing();
        fireEvent.click(screen.getByRole("button", { name: "저장" }));
        await flushPromises();

        fireEvent.keyDown(timeInput()!, { key: "Escape" });
        fireEvent.click(screen.getByRole("button", { name: "취소" }));

        expect(timeInput()).not.toBeNull();
        await act(async () => saving.resolve({}));
      });
    });
  });
});
