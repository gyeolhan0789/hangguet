// 기준: Swagger 4.7 회사 목록(영문 다음 한글 가나다순, aliases는 띄어쓰기 · (주) 등을 빼고 소문자로 맞춘 값)
// · 사용자 결정(2026-11-03: 비어 있으면 전체, 입력하면 회사명 · 별칭에 든 회사만, 별칭으로 찾으면 이름 옆에 별칭,
//   목록을 못 불러오면 일반 입력칸 · 2026-11-05: 맞는 회사가 없으면 목록 창을 띄우지 않음) · WAI-ARIA APG Combobox
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import type { CompanyItem } from "@/types/api";

import { CompanyCombobox } from "./company-combobox";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 4.7 200 예시(받은 순서 그대로) + 띄어쓰기가 든 회사명(예시에 없어 덧붙임)
const COMPANIES: CompanyItem[] = [
  { id: 2, name: "NAVER", aliases: ["naver", "네이버"] },
  { id: 7, name: "NC", aliases: ["nc", "ncsoft", "엔씨소프트"] },
  { id: 3, name: "SK하이닉스", aliases: ["sk하이닉스", "skhynix"] },
  { id: 1, name: "삼성전자", aliases: ["삼성전자", "samsungelectronics"] },
  { id: 5, name: "카카오", aliases: ["카카오", "kakao"] },
  { id: 4, name: "현대자동차", aliases: ["현대자동차", "hyundaimotorcompany"] },
  { id: 9, name: "LG 전자", aliases: ["lg전자", "lgelectronics"] },
];
const NAMES = COMPANIES.map(({ name }) => name);

/** 부모 폼 대신 값을 들고 있는 작은 래퍼 */
function Harness({ companies = COMPANIES }: Readonly<{ companies?: CompanyItem[] }>) {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="companyName">회사명</label>
      <CompanyCombobox
        id="companyName"
        companies={companies}
        value={value}
        onValueChange={setValue}
      />
    </>
  );
}

const input = () => screen.getByLabelText<HTMLInputElement>("회사명");
const type = (value: string) => fireEvent.change(input(), { target: { value } });
/** 키를 누른다. 기본 동작(폼 보내기 등)을 막았으면 false */
const press = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(input(), { key, ...init });
const optionNames = () => screen.queryAllByRole("option").map((option) => option.textContent);
const selected = () => screen.queryByRole("option", { selected: true })?.textContent;

describe("CompanyCombobox · 회사명 자동 완성", () => {
  describe("화면 표시", () => {
    it("회사 목록이 없으면 목록 없는 일반 입력칸으로 그린다", () => {
      render(<Harness companies={[]} />);

      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.getByRole("textbox", { name: "회사명" })).toBeDefined();
    });

    it("칸에 들어가면 받은 순서대로 회사 전체를 보여 준다", () => {
      render(<Harness />);

      fireEvent.focus(input());

      expect(optionNames()).toEqual(NAMES);
    });

    it("입력하면 회사명에 입력이 든 회사만 남기고 맞는 글자를 표시한다", () => {
      render(<Harness />);

      type("삼성");

      expect(optionNames()).toEqual(["삼성전자"]);
      expect(
        within(screen.getByRole("option")).getByText("삼성", { selector: "mark" }),
      ).toBeDefined();
    });

    it("띄어쓰기가 든 회사명도 맞는 글자를 이어서 표시한다", () => {
      render(<Harness />);

      type("lg전");

      expect(
        within(screen.getByRole("option")).getByText("LG 전", { selector: "mark" }),
      ).toBeDefined();
    });

    it("별칭으로만 맞으면 회사명 옆에 그 별칭을 보여 준다", () => {
      render(<Harness />);

      type("kakao");

      expect(optionNames()).toEqual(["카카오kakao"]);
    });

    it("별칭으로만 맞은 회사는 회사명에 맞는 글자 표시를 하지 않는다", () => {
      render(<Harness />);

      type("네이버");

      const marks = Array.from(screen.getByRole("option").querySelectorAll("mark"));
      expect(marks.map((mark) => mark.textContent)).toEqual(["네이버"]);
    });

    it("맞는 회사가 없으면 목록 창을 띄우지 않는다", () => {
      render(<Harness />);

      type("○○전자");

      expect(input().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it.each([
      { query: "네 이버", company: "NAVER" },
      { query: "(주)카카오", company: "카카오" },
      { query: "㈜카카오", company: "카카오" },
      { query: "주식회사 카카오", company: "카카오" },
      { query: "Naver Corp.", company: "NAVER" },
      { query: "NAVER Co., Ltd.", company: "NAVER" },
    ])(
      "입력 '$query'는 띄어쓰기 · 회사 형태 표기를 빼고 소문자로 맞춰 찾는다",
      ({ query, company }) => {
        render(<Harness />);

        type(query);

        const options = screen.getAllByRole("option");
        expect(options).toHaveLength(1);
        expect(options[0].textContent?.startsWith(company)).toBe(true);
      },
    );
  });

  describe("사용자 조작", () => {
    it("회사 목록이 없을 때 입력하면 그 값을 넘긴다", () => {
      const onValueChange = vi.fn();
      render(
        <CompanyCombobox
          aria-label="회사명"
          companies={[]}
          value=""
          onValueChange={onValueChange}
        />,
      );

      fireEvent.change(screen.getByRole("textbox", { name: "회사명" }), {
        target: { value: "○○전자" },
      });

      expect(onValueChange).toHaveBeenCalledWith("○○전자");
    });

    it("닫힌 상태에서 ↓를 누르면 목록을 연다", () => {
      render(<Harness />);

      press("ArrowDown");

      expect(input().getAttribute("aria-expanded")).toBe("true");
      expect(optionNames()).toEqual(NAMES);
    });

    it("열린 상태에서 ↓를 누르면 다음 회사를 고른다", () => {
      render(<Harness />);
      fireEvent.focus(input());
      press("ArrowDown");

      press("ArrowDown");

      const nc = screen.getByRole("option", { name: "NC", selected: true });
      expect(input().getAttribute("aria-activedescendant")).toBe(nc.id);
    });

    it("열린 상태에서 ↑를 누르면 앞 회사를 고른다", () => {
      render(<Harness />);
      fireEvent.focus(input());
      press("ArrowDown");
      press("ArrowDown");

      press("ArrowUp");

      expect(selected()).toBe("NAVER");
    });

    it("방향키로 고르면 고른 회사가 보이도록 목록을 스크롤한다", () => {
      // jsdom에는 scrollIntoView가 없어 이 테스트에서만 붙이고 끝나면 뗀다
      const scrollIntoView = vi.fn();
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        value: scrollIntoView,
        configurable: true,
      });
      onTestFinished(() => {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      });
      render(<Harness />);
      fireEvent.focus(input());

      press("ArrowDown");

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("option", { name: "NAVER" }));
    });

    it("회사를 고르고 Enter를 누르면 그 회사명을 넣고 닫으며 폼 제출을 막는다", () => {
      render(<Harness />);
      fireEvent.focus(input());
      press("ArrowDown");
      press("ArrowDown");

      const notPrevented = press("Enter");

      expect(notPrevented).toBe(false);
      expect(input().value).toBe("NC");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("고른 회사가 없으면 Enter를 막지 않는다", () => {
      render(<Harness />);
      fireEvent.focus(input());

      expect(press("Enter")).toBe(true);
    });

    it("한글을 조합하는 중의 Enter로는 고르지 않는다", () => {
      render(<Harness />);
      fireEvent.focus(input());
      press("ArrowDown");

      press("Enter", { isComposing: true });

      expect(input().value).toBe("");
      expect(selected()).toBe("NAVER");
    });

    it("Esc를 누르면 고르지 않고 닫는다", () => {
      render(<Harness />);
      fireEvent.focus(input());
      press("ArrowDown");

      press("Escape");

      expect(input().value).toBe("");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("회사를 누르면 그 회사명을 넣고 닫는다", () => {
      render(<Harness />);
      fireEvent.focus(input());

      fireEvent.click(screen.getByRole("option", { name: "카카오" }));

      expect(input().value).toBe("카카오");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("회사를 누르는 동안에는 칸의 포커스를 잃지 않게 한다", () => {
      render(<Harness />);
      fireEvent.focus(input());

      expect(fireEvent.mouseDown(screen.getByRole("option", { name: "카카오" }))).toBe(false);
    });

    it("칸을 벗어나면 닫는다", () => {
      render(<Harness />);
      fireEvent.focus(input());

      fireEvent.blur(input());

      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("고른 뒤 다시 입력하면 고른 회사가 풀린다", () => {
      render(<Harness />);
      fireEvent.focus(input());
      press("ArrowDown");

      type("카");

      expect(selected()).toBeUndefined();
      expect(input().getAttribute("aria-activedescendant")).toBeNull();
    });

    it.each([
      { label: "↑", key: "ArrowUp" },
      { label: "Esc", key: "Escape" },
    ])("목록이 닫혀 있으면 '$label'를 막지 않는다", ({ key }) => {
      render(<Harness />);

      expect(press(key)).toBe(true);
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "첫 회사에서 ↑", moves: ["ArrowDown", "ArrowUp"], stay: "NAVER" },
      {
        label: "마지막 회사에서 ↓",
        moves: Array<string>(COMPANIES.length + 1).fill("ArrowDown"),
        stay: "LG 전자",
      },
    ])("'$label'이면 그 자리에 머문다", ({ moves, stay }) => {
      render(<Harness />);
      fireEvent.focus(input());

      moves.forEach((key) => press(key));

      expect(selected()).toBe(stay);
    });

    it("표기가 겹친 입력('Co(주)Ltd')은 '(주)'만 빼서 찾으므로 맞는 회사가 없어 목록 창을 띄우지 않는다", () => {
      render(<Harness />);

      // 원문에서 '(주)'만 빠져 'coltd'로 찾는다. 차례로 빼면 'CoLtd'가 다시 빠져 빈 입력(전체)이 된다
      type("Co(주)Ltd");

      expect(input().getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });
});
