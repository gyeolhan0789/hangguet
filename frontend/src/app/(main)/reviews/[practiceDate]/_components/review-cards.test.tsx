// 기준: Figma S08(18:2710: '오늘 나아진 점' · '다음에 해볼 것') · S08-C(18:4720: '오늘의 기준점') · 웹 Swagger 7.1 criteria · nextActions
// · 사용자 결정(2026-10-22: 자소서 검증은 '좋아요'일 때만 [통과], 지난 날짜는 '오늘' 문구를 그날 문구로)
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { GROWTH_REVIEW } from "@/test/growth-review-examples";

import { ImprovedCard } from "./review-cards";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 7.1 200 예시 'S08 오늘의 성장 리뷰'
const { S08 } = GROWTH_REVIEW;

/** 보조 기술이 읽는 글(aria-hidden으로 숨긴 숫자 올리기는 빼고 읽는다) */
function spoken(element: Element) {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden]").forEach((hidden) => hidden.remove());
  return copy.textContent;
}

const rowsOf = (name: string) =>
  within(screen.getByRole("region", { name })).getAllByRole("listitem").map(spoken);

describe("ImprovedCard · 나아진 점 카드", () => {
  describe("화면 표시", () => {
    it("오른 기준은 '+N'과 설명을, '좋아요'인 자소서 검증은 '통과'와 설명을 보여 준다", () => {
      render(<ImprovedCard criteria={S08.criteria} today />);

      expect(rowsOf("오늘 나아진 점")).toEqual([
        "전달력+8말 끊김이 줄었어요",
        "논리성+4결론부터 말했어요",
        "자소서 검증통과막힘 없이 통과",
      ]);
    });
  });
});
