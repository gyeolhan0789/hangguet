// 기준: Figma 라이트 · 다크 테마(헤더 테마 버튼) · 루트 레이아웃 첫 페인트 전 테마 스크립트
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTheme, THEME_SCRIPT, toggleTheme } from "./theme";

// 경계 mock: OS 테마 설정(matchMedia)과 저장소(localStorage) 실패
function stubOsTheme(os: "light" | "dark") {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: os === "dark" })),
  );
}
const runThemeScript = () => new Function(THEME_SCRIPT)() as void;
const htmlTheme = () => document.documentElement.dataset.theme;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("getTheme · 지금 테마", () => {
  describe("정상 처리", () => {
    it.each([
      { value: "dark", expected: "dark" },
      { value: "light", expected: "light" },
      { value: "없음", expected: "light" },
    ])("<html> 테마가 '$value'이면 '$expected'를 돌려준다", ({ value, expected }) => {
      if (value !== "없음") document.documentElement.dataset.theme = value;

      expect(getTheme()).toBe(expected);
    });
  });
});

describe("toggleTheme · 테마 바꾸기", () => {
  describe("정상 처리", () => {
    it.each([
      { from: "light", to: "dark" },
      { from: "dark", to: "light" },
    ])("지금 테마가 '$from'이면 '$to'로 바꾸고 선택을 저장한다", ({ from, to }) => {
      document.documentElement.dataset.theme = from;

      expect(toggleTheme()).toBe(to);
      expect(htmlTheme()).toBe(to);
      expect(localStorage.getItem("hk-theme")).toBe(to);
    });
  });

  describe("오류 처리", () => {
    it("저장소를 쓸 수 없어도 테마는 바꾼다", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
      document.documentElement.dataset.theme = "light";

      expect(toggleTheme()).toBe("dark");
      expect(htmlTheme()).toBe("dark");
    });
  });
});

describe("THEME_SCRIPT · 첫 페인트 전 테마", () => {
  describe("정상 처리", () => {
    it("저장한 테마가 있으면 OS 설정과 상관없이 그 테마를 적용한다", () => {
      localStorage.setItem("hk-theme", "light");
      stubOsTheme("dark");

      runThemeScript();

      expect(htmlTheme()).toBe("light");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { stored: "없음", os: "dark", expected: "dark" },
      { stored: "blue", os: "light", expected: "light" },
    ] as const)(
      "저장한 값이 '$stored'이고 OS가 '$os'이면 '$expected'를 적용한다",
      ({ stored, os, expected }) => {
        if (stored !== "없음") localStorage.setItem("hk-theme", stored);
        stubOsTheme(os);

        runThemeScript();

        expect(htmlTheme()).toBe(expected);
      },
    );
  });

  describe("오류 처리", () => {
    it("저장소를 읽을 수 없어도 오류를 던지지 않는다", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("SecurityError");
      });

      expect(runThemeScript).not.toThrow();
    });
  });
});
