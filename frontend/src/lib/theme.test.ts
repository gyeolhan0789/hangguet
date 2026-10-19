import { beforeEach, describe, expect, it } from "vitest";

import { getTheme, THEME_SCRIPT, toggleTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("toggleTheme", () => {
  it("라이트와 다크를 번갈아 바꾸고 선택을 저장한다", () => {
    document.documentElement.dataset.theme = "light";

    expect(toggleTheme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("hk-theme")).toBe("dark");

    expect(toggleTheme()).toBe("light");
    expect(getTheme()).toBe("light");
  });
});

describe("THEME_SCRIPT", () => {
  it("저장된 테마를 <html>에 적용한다", () => {
    localStorage.setItem("hk-theme", "dark");

    new Function(THEME_SCRIPT)();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("저장된 값이 없으면 OS 설정을 따른다", () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("dark"),
    })) as typeof matchMedia;

    new Function(THEME_SCRIPT)();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
