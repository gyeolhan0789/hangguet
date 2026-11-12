// @vitest-environment node
// 기준: 웹 Swagger 5.13(persona · mode · startedAt · endedAt · status) · 5.15 month 범위 · Figma 연습 기록 초안(232:843)
// · 사용자 결정(2026-10-23: 달을 넘기면 같은 '일'(그 달에 없으면 말일, 미래면 오늘), 실패는 '분석 실패')
import { describe, expect, it } from "vitest";

import { SESSION_LIST } from "@/test/session-list-examples";

import { dateInMonth, monthDayLabel, pendingLabel, sessionMeta } from "./format";

// 예시 데이터: 웹 Swagger 5.13 '완료·분석 중'(2026-10-21) · 웹 목 서버 2026-10-20(실패)
const [COMPLETED, ANALYZING] = SESSION_LIST.DAILY.content;
const [FAILED] = SESSION_LIST.DAY_20.content;

describe("sessionMeta · 면접 줄 메타", () => {
  describe("정상 처리", () => {
    it("면접관 이름 · 면접 방식 · 걸린 분을 ' · '로 잇는다", () => {
      expect(sessionMeta(COMPLETED)).toBe("악마 면접관 · 화상 · 20분");
    });
  });
});

describe("pendingLabel · 분석 상태 표시", () => {
  describe("정상 처리", () => {
    it("분석 중(ANALYZING)이면 '분석 중'을 돌려준다", () => {
      expect(pendingLabel(ANALYZING)).toBe("분석 중");
    });

    it("분석에 실패했으면(FAILED) '분석 실패'를 돌려준다", () => {
      expect(pendingLabel(FAILED)).toBe("분석 실패");
    });

    it("분석이 끝났으면(COMPLETED) null을 돌려준다", () => {
      expect(pendingLabel(COMPLETED)).toBeNull();
    });
  });
});

describe("monthDayLabel · 날짜 'M월 D일'", () => {
  describe("정상 처리", () => {
    it("'YYYY-MM-DD'를 앞자리 0 없이 'M월 D일'로 바꾼다", () => {
      expect(monthDayLabel("2026-09-05")).toBe("9월 5일");
    });
  });
});

describe("dateInMonth · 달을 넘길 때 고를 날", () => {
  describe("정상 처리", () => {
    it("지난 달로 넘기면 같은 '일'을 고른다", () => {
      expect(dateInMonth("2026-09", "2026-10-21", "2026-10-23")).toBe("2026-09-21");
    });
  });

  describe("경계값", () => {
    it("넘긴 달에 같은 '일'이 없으면 그달 말일을 고른다", () => {
      expect(dateInMonth("2026-09", "2026-10-31", "2026-11-05")).toBe("2026-09-30");
    });

    it("오늘이 든 달로 넘기면서 같은 '일'이 오늘 뒤면 오늘을 고른다", () => {
      expect(dateInMonth("2026-10", "2026-09-28", "2026-10-23")).toBe("2026-10-23");
    });

    it("오늘이 든 달보다 뒤의 달이면 null을 돌려준다", () => {
      expect(dateInMonth("2026-11", "2026-10-21", "2026-10-23")).toBeNull();
    });

    it("0001년 1월보다 앞의 달이면 null을 돌려준다", () => {
      expect(dateInMonth("0000-12", "0001-01-15", "2026-10-23")).toBeNull();
    });
  });
});
