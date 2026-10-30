import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { LegalDocument } from "@/lib/legal/documents";

import { LegalDocumentView } from "./legal-document";

// 본문 덩어리(제목 · 문단 · 목록 · 표)를 순서대로 알맞은 요소로 그리는지 본다. 기준: lib/legal/documents.ts LegalBlock
const doc: LegalDocument = {
  title: "테스트 문서",
  blocks: [
    { kind: "heading", text: "제1조(목적)" },
    { kind: "paragraph", text: "목적 문단" },
    { kind: "list", ordered: true, items: ["첫째", "둘째"] },
    { kind: "list", ordered: false, items: ["점"] },
    { kind: "table", head: ["목적", "항목"], rows: [["회원 관리", "이메일"]] },
  ],
};

afterEach(() => {
  cleanup();
});

describe("LegalDocumentView", () => {
  it("모달에서는 소제목을 h3로 그린다(모달 제목 h2 아래)", () => {
    render(<LegalDocumentView doc={doc} headingLevel={3} />);

    expect(screen.getByRole("heading", { level: 3, name: "제1조(목적)" })).toBeTruthy();
  });

  it("제목 · 문단 · 번호 목록 · 점 목록 · 표를 그린다", () => {
    render(<LegalDocumentView doc={doc} />);

    expect(screen.getByRole("heading", { level: 2, name: "제1조(목적)" })).toBeTruthy();
    expect(screen.getByText("목적 문단")).toBeTruthy();
    const [ordered, bulleted] = screen.getAllByRole("list");
    expect(ordered.tagName).toBe("OL");
    expect(within(ordered).getAllByRole("listitem")).toHaveLength(2);
    expect(bulleted.tagName).toBe("UL");
    expect(within(bulleted).getAllByRole("listitem")).toHaveLength(1);

    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["목적", "항목"]);
    expect(within(table).getByRole("cell", { name: "이메일" })).toBeTruthy();
  });
});
