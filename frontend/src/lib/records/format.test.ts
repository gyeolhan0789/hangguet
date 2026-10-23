import { describe, expect, it } from "vitest";

import { SESSION_LIST } from "@/test/session-list-examples";

import { dateInMonth, monthDayLabel, pendingLabel, sessionMeta } from "./format";

// 기준: Figma 연습 기록 초안(232:843: '악마 면접관 · 화상 · 20분') · 웹 Swagger 5.13 예시
// · VIDEO → 화상 · CHAT → 채팅, 소요 시간 = endedAt − startedAt(분), 미래 날짜는 선택하지 않음
// · 사용자 결정(2026-10-23: 달을 넘기면 같은 '일', 그 달에 없으면 말일, 미래면 오늘 · 실패는 '분석 실패')

const [completed, analyzing] = SESSION_LIST.DAILY.content;
const [failed] = SESSION_LIST.DAY_20.content;

describe("sessionMeta (면접관 · 방식 · 걸린 시간)", () => {
  it("자정을 넘긴 면접도 시작 ~ 끝의 분으로 센다(23:50 ~ 00:10 → 20분)", () => {
    expect(sessionMeta(completed)).toBe("악마 면접관 · 화상 · 20분");
  });

  it("커피챗 · 채팅", () => {
    expect(sessionMeta(analyzing)).toBe("개발자 커피챗 · 채팅 · 12분");
  });
});

describe("pendingLabel (분석이 끝나지 않은 면접)", () => {
  it("분석 중 · 분석 실패만 이름이 있고, 완료는 null", () => {
    expect(pendingLabel(analyzing)).toBe("분석 중");
    expect(pendingLabel(failed)).toBe("분석 실패");
    expect(pendingLabel(completed)).toBeNull();
  });
});

describe("monthDayLabel", () => {
  it("YYYY-MM-DD → 'M월 D일'", () => {
    expect(monthDayLabel("2026-10-21")).toBe("10월 21일");
    expect(monthDayLabel("2026-01-05")).toBe("1월 5일");
  });
});

describe("dateInMonth (달을 넘길 때 고를 날)", () => {
  const TODAY = "2026-10-23";

  it("지난 달은 같은 '일'", () => {
    expect(dateInMonth("2026-09", "2026-10-21", TODAY)).toBe("2026-09-21");
  });

  it("그 달에 같은 '일'이 없으면 말일(31일 → 9월 30일 · 2월 28일)", () => {
    expect(dateInMonth("2026-09", "2026-10-31", TODAY)).toBe("2026-09-30");
    expect(dateInMonth("2026-02", "2026-03-31", TODAY)).toBe("2026-02-28");
  });

  it("오늘이 든 달로 오면서 같은 '일'이 미래면 오늘", () => {
    expect(dateInMonth("2026-10", "2026-09-30", TODAY)).toBe(TODAY);
    expect(dateInMonth("2026-10", "2026-09-23", TODAY)).toBe(TODAY);
    expect(dateInMonth("2026-10", "2026-09-22", TODAY)).toBe("2026-10-22");
  });

  it("오늘이 든 달보다 뒤의 달은 고를 수 없다(null)", () => {
    expect(dateInMonth("2026-11", "2026-10-21", TODAY)).toBeNull();
  });

  it("해를 넘겨도 센다", () => {
    expect(dateInMonth("2025-12", "2026-01-15", TODAY)).toBe("2025-12-15");
  });
});
