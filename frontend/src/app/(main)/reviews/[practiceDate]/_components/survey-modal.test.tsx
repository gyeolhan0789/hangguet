// 기준: Figma S08-B Survey Modal(18:4690) · 기획 메모 S08-B(18:3679: [설문 참여하기] → 구글폼 새 탭(유저 ID · 스트릭 일수),
// 참여하면 같은 회차 다시 안 뜸) · 모션 메모 S08-B(18:4715: 진입 1.2초 뒤 노출, 돌아오면 '고마워요!' 토스트)
// · WAI-ARIA APG 대화상자 패턴(안에서만 Tab, Esc로 닫힘)
// · 사용자 결정(2026-10-22: 주소의 {userId} · {streak} 자리를 채운다, 본 회차는 회원별로 브라우저 저장소에 적어 다시 띄우지 않는다)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/stores/toast-store";
import { spyTimers } from "@/test/timers";

import { SURVEY_DELAY_MS, SurveyModal, surveyLink, surveySeenKey } from "./survey-modal";

// 경계 mock: 연출(motion)은 건너뛴다. 시간은 가짜 타이머(토스트 id의 Date.now도 고정), 새 탭(window.open) · 브라우저 저장소 ·
// 화면 보임 상태(document.visibilityState)는 테스트가 정한다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: 설문 주소(자리 표시 포함) · 회원 1 · 7일째 회차
const SURVEY_URL = "https://forms.test/s?entry.1={userId}&entry.2={streak}";
const USER_ID = 1;
const ROUND = 7;
const KEY = surveySeenKey(USER_ID, ROUND);
const DIALOG = { name: "1분만 의견을 들려주세요" };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useToastStore.setState({ toast: null });
});

function renderModal() {
  return render(<SurveyModal round={ROUND} surveyUrl={SURVEY_URL} userId={USER_ID} />);
}

/** 들어오고 1.2초를 보내 설문을 띄운다 */
function openModal() {
  const view = renderModal();
  act(() => vi.advanceTimersByTime(1200));
  return view;
}

/** 화면 보임 상태가 바뀌었다고 알린다(설문 탭에서 돌아옴 · 떠남) */
function comeBack(state: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const toastText = () => useToastStore.getState().toast?.text ?? null;
const button = (name: string) => screen.getByRole("button", { name });

describe("surveyLink · 설문 주소 만들기", () => {
  describe("정상 처리", () => {
    it("주소의 {userId} · {streak} 자리를 모두 회원 id와 스트릭으로 채운다", () => {
      expect(surveyLink("https://forms.test/s?a={userId}&b={streak}&c={userId}", 1, 7)).toBe(
        "https://forms.test/s?a=1&b=7&c=1",
      );
    });
  });
});

describe("SurveyModal · S08-B 설문 유도", () => {
  describe("화면 표시", () => {
    it("이 회원이 이 회차를 이미 봤으면 띄우지 않는다", () => {
      localStorage.setItem(KEY, "later");

      openModal();

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("다른 회원이 본 기록은 이 회원에게 영향을 주지 않는다", () => {
      localStorage.setItem(surveySeenKey(2, ROUND), "later");

      openModal();

      expect(screen.getByRole("dialog", DIALOG)).toBeDefined();
    });
  });

  describe("사용자 조작", () => {
    it("[설문 참여하기]를 누르면 채운 주소를 새 탭으로 열고 이 회차를 다시 띄우지 않게 한 뒤 닫는다", () => {
      const open = vi.fn();
      vi.stubGlobal("open", open);
      openModal();

      fireEvent.click(button("설문 참여하기"));

      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toBe("https://forms.test/s?entry.1=1&entry.2=7");
      expect(localStorage.getItem(KEY)).not.toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it.each([
      { label: "[다음에 할게요]", close: () => fireEvent.click(button("다음에 할게요")) },
      { label: "닫기(X)", close: () => fireEvent.click(button("닫기")) },
      {
        label: "Esc",
        close: () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }),
      },
    ])("'$label'로 닫으면 이 회차를 다시 띄우지 않게 하고 닫는다", ({ close }) => {
      openModal();

      close();

      expect(localStorage.getItem(KEY)).not.toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("상태 변화", () => {
    it("참여한 뒤 설문 탭에서 돌아오면 '고마워요!'를 한 번만 띄운다", () => {
      vi.stubGlobal("open", vi.fn());
      openModal();
      fireEvent.click(button("설문 참여하기"));
      comeBack("hidden");

      comeBack("visible");
      expect(toastText()).toBe("고마워요!");
      act(() => useToastStore.getState().hide());
      comeBack("visible");

      expect(toastText()).toBeNull();
    });

    it("참여한 뒤 화면이 숨겨지기만 하면(hidden) '고마워요!'를 띄우지 않는다", () => {
      vi.stubGlobal("open", vi.fn());
      openModal();
      fireEvent.click(button("설문 참여하기"));

      comeBack("hidden");

      expect(toastText()).toBeNull();
    });

    it("참여하지 않았으면 돌아와도 '고마워요!'를 띄우지 않는다", () => {
      openModal();
      fireEvent.click(button("다음에 할게요"));

      comeBack("visible");

      expect(toastText()).toBeNull();
    });
  });

  describe("오류 처리", () => {
    it("브라우저 저장소를 읽지 못하면 본 적 없는 것으로 보고 설문을 띄운다", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });

      openModal();

      expect(screen.getByRole("dialog", DIALOG)).toBeDefined();
    });

    it("브라우저 저장소에 쓰지 못해도 설문을 닫는다", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      openModal();

      fireEvent.click(button("다음에 할게요"));

      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("시간 경과", () => {
    it("들어오고 1.2초가 지나면 회차 문구로 설문을 띄운다", () => {
      renderModal();

      act(() => vi.advanceTimersByTime(1199));
      expect(screen.queryByRole("dialog")).toBeNull();
      act(() => vi.advanceTimersByTime(1));

      expect(screen.getByRole("dialog", DIALOG).textContent).toContain(
        "7일 동안 연습해보니 어땠나요?",
      );
    });
  });

  describe("정리", () => {
    it("열려 있는 동안 뒤 페이지 스크롤을 잠그고 닫으면 푼다", () => {
      openModal();
      expect(document.documentElement.style.overflow).toBe("hidden");

      fireEvent.click(button("다음에 할게요"));

      expect(document.documentElement.style.overflow).toBe("");
    });

    it("1.2초 전에 화면을 벗어나면 설문 예약을 취소한다", () => {
      const timers = spyTimers();
      const { unmount } = renderModal();

      unmount();

      expect(timers.cleared("timeout", SURVEY_DELAY_MS)).toBe(true);
    });

    it("화면을 벗어나면 돌아옴 감지를 멈춘다", () => {
      vi.stubGlobal("open", vi.fn());
      const { unmount } = openModal();
      fireEvent.click(button("설문 참여하기"));

      unmount();
      comeBack("visible");

      expect(toastText()).toBeNull();
    });
  });
});
