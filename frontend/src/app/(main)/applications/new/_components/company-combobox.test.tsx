import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompanyItem } from "@/types/api";

import { ApplicationWriteForm } from "./application-write-form";
import { CompanyCombobox } from "./company-combobox";

// 기준: Swagger 4.7 회사 목록 예시(영문 다음 한글 가나다순, aliases는 띄어쓰기 · (주) 등을 빼고 소문자로 맞춘 값)
// · 사용자 결정(2026-11-03: 비어 있으면 전체, 입력하면 회사명 · 별칭에 든 회사만, 별칭으로 찾으면 이름 옆에 별칭,
//   없으면 아직 수집되지 않은 회사라는 안내, 목록을 못 불러오면 일반 입력칸) · WAI-ARIA APG Combobox(방향키 · Enter · Esc)
// 지원서 쓰기 폼에서는 서버 액션 경계만 바꾼다. 실제 4.7 · 4.1 요청은 E2E(applications.spec.ts)가 본다.

const createApplication = vi.hoisted(() => vi.fn());
vi.mock("@/lib/application/actions", () => ({
  createApplication: (...args: unknown[]) => createApplication(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ bfcacheId: "entry-1" }) }));

// 목록이 나타나고 사라지는 연출을 건너뛰어 실제 시간을 기다리지 않는다. 퇴장 연출(AnimatePresence)은 바로 지운다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  AnimatePresence: ({ children }: { children?: ReactNode }) => children,
}));
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});
beforeEach(() => {
  createApplication.mockReset();
});
afterEach(() => {
  cleanup();
});

const COMPANIES: CompanyItem[] = [
  { id: 2, name: "NAVER", aliases: ["naver", "네이버"] },
  { id: 7, name: "NC", aliases: ["nc", "ncsoft", "엔씨소프트"] },
  { id: 1, name: "삼성전자", aliases: ["삼성전자", "samsungelectronics"] },
  { id: 5, name: "카카오", aliases: ["카카오", "kakao"] },
  { id: 9, name: "LG 전자", aliases: ["lg전자", "lgelectronics"] },
];

function Harness({ companies = COMPANIES }: { companies?: CompanyItem[] }) {
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

const input = () => screen.getByLabelText("회사명") as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
/** 키를 누른다. 기본 동작(폼 보내기 등)을 막았으면 false */
const key = (name: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(input(), { key: name, ...init });
const options = () => screen.queryAllByRole("option").map((option) => option.textContent);
const selected = () => screen.queryByRole("option", { selected: true })?.textContent;

describe("CompanyCombobox (지원서 쓰기 회사명)", () => {
  it("칸을 누르면 받은 순서대로 회사 전체를 보여 준다", () => {
    render(<Harness />);

    fireEvent.focus(input());

    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(options()).toEqual(["NAVER", "NC", "삼성전자", "카카오", "LG 전자"]);
  });

  it("입력하면 회사명에 든 회사만 남기고 맞는 글자를 표시한다", () => {
    render(<Harness />);

    type("삼성");

    expect(options()).toEqual(["삼성전자"]);
    expect(within(screen.getByRole("option")).getByText("삼성", { selector: "mark" })).toBeTruthy();
  });

  it("띄어쓰기가 든 회사명도 맞는 글자를 이어서 표시한다", () => {
    render(<Harness />);

    type("lg전");

    expect(
      within(screen.getByRole("option")).getByText("LG 전", { selector: "mark" }),
    ).toBeTruthy();
  });

  it("별칭으로 찾으면 이름 옆에 그 별칭을 보여 준다", () => {
    render(<Harness />);

    type("네이버");
    expect(options()).toEqual(["NAVER네이버"]);

    type("Samsung");
    expect(options()).toEqual(["삼성전자samsungelectronics"]);
  });

  it("띄어쓰기 · (주)를 빼고 소문자로 맞춰 찾는다", () => {
    render(<Harness />);

    type("(주) 카 카오");

    expect(options()).toEqual(["카카오"]);
  });

  it("맞는 회사가 없으면 목록 대신 아직 수집되지 않은 회사라는 안내를 보여 주고, 방향키 · Enter로 아무것도 고르지 않는다", () => {
    render(<Harness />);

    type("○○전자");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe(
      "아직 데이터가 수집되지 않은 회사입니다. 추후 업데이트를 기다려주세요",
    );
    key("ArrowUp");
    key("ArrowDown");
    expect(key("Enter")).toBe(true);
    expect(input().value).toBe("○○전자");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("방향키로 고르고 Enter를 누르면 그 회사명을 넣고 닫으며, 폼은 보내지 않는다", () => {
    render(<Harness />);
    fireEvent.focus(input());

    key("ArrowDown");
    key("ArrowDown");
    const nc = screen.getByRole("option", { name: "NC", selected: true });
    expect(input().getAttribute("aria-activedescendant")).toBe(nc.id);

    expect(key("Enter")).toBe(false);
    expect(input().value).toBe("NC");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("고른 회사가 없으면 Enter는 막지 않는다(폼을 보낸다)", () => {
    render(<Harness />);
    fireEvent.focus(input());

    expect(key("Enter")).toBe(true);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("첫 회사에서 ↑, 마지막 회사에서 ↓를 누르면 그 자리에 머문다", () => {
    render(<Harness />);
    fireEvent.focus(input());

    key("ArrowDown");
    key("ArrowUp");
    expect(selected()).toBe("NAVER");

    for (let i = 0; i < COMPANIES.length + 2; i++) key("ArrowDown");
    expect(selected()).toBe("LG 전자");
  });

  it("고른 뒤 다시 입력하면 고른 회사가 풀린다", () => {
    render(<Harness />);
    fireEvent.focus(input());
    key("ArrowDown");
    key("ArrowDown");

    type("카");

    expect(selected()).toBeUndefined();
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("한글을 조합하는 중의 Enter로는 고르지 않는다", () => {
    render(<Harness />);
    fireEvent.focus(input());
    key("ArrowDown");

    key("Enter", { isComposing: true });

    expect(input().value).toBe("");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("회사를 누르면 그 회사명을 넣고 닫는다", () => {
    render(<Harness />);
    fireEvent.focus(input());

    fireEvent.click(screen.getByRole("option", { name: "카카오" }));

    expect(input().value).toBe("카카오");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Esc는 고르지 않고 닫고, 닫힌 뒤 ↓를 누르면 다시 연다", () => {
    render(<Harness />);
    type("NA");

    key("Escape");
    expect(input().value).toBe("NA");
    expect(input().getAttribute("aria-expanded")).toBe("false");

    key("ArrowDown");
    expect(options()).toEqual(["NAVER"]);
  });

  it("칸을 벗어나면 닫는다", () => {
    render(<Harness />);
    fireEvent.focus(input());

    fireEvent.blur(input());

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("회사 목록이 없으면 목록 없는 일반 입력칸이다", () => {
    render(<Harness companies={[]} />);

    fireEvent.focus(input());
    type("○○전자");

    expect(input().getAttribute("role")).toBeNull();
    expect(input().value).toBe("○○전자");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("지원서 쓰기의 회사명 자동 완성", () => {
  it("목록에서 고른 회사명으로 저장하고, 서버가 회사명을 거절하면 그 칸을 오류로 표시한다", async () => {
    createApplication.mockResolvedValue({ fieldErrors: { companyName: "1~100자입니다." } });
    render(<ApplicationWriteForm from="applications" companies={COMPANIES} />);
    const company = screen.getByRole("combobox", { name: "회사명" });

    fireEvent.change(company, { target: { value: "네이버" } });
    fireEvent.click(screen.getByRole("option", { name: /^NAVER/ }));
    fireEvent.change(screen.getByLabelText("직무"), { target: { value: "백엔드 개발자" } });
    fireEvent.change(screen.getByLabelText("문항 1"), { target: { value: "지원 동기" } });
    fireEvent.change(screen.getByLabelText("문항 1 답변"), { target: { value: "저는…" } });
    const save = screen.getByRole("button", { name: "저장하기" });
    await waitFor(() => expect(save).toHaveProperty("disabled", false));
    fireEvent.click(save);

    await waitFor(() =>
      expect(createApplication).toHaveBeenCalledWith(
        expect.objectContaining({ companyName: "NAVER" }),
        "applications",
      ),
    );
    expect((await screen.findByRole("alert")).textContent).toBe("1~100자입니다.");
    expect(company.getAttribute("aria-invalid")).toBe("true");
  });
});
