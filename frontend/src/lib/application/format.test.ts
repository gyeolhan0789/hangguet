import { describe, expect, it } from "vitest";

import type { SessionListItem } from "@/types/api";

import { applicationDate, applicationSessionTitle } from "./format";

// 기준: Figma 지원 관리 · 목록 · 상세(작성일 'YYYY.MM.DD') · 지원 관리 · 상세 · 면접에 씀(면접 기록 줄 '10.21 · 개발자 커피챗 · 채팅')
// · Swagger 4.2 createdAt · 4.6 startedAt · persona · mode

const session = {
  id: 54,
  companyName: "△△소프트",
  jobTitle: "서버 개발자",
  persona: "COFFEE_CHAT",
  mode: "CHAT",
  status: "ANALYZING",
  startedAt: "2026-10-21T19:30:00+09:00",
  endedAt: "2026-10-21T19:42:00+09:00",
  answeredCount: 3,
  summary: null,
  criterionGrades: [],
} satisfies SessionListItem;

describe("applicationDate", () => {
  it("+09:00 일시의 날짜를 'YYYY.MM.DD'로 보여 준다", () => {
    expect(applicationDate("2026-10-15T23:55:00+09:00")).toBe("2026.10.15");
  });

  // UTC로는 전날(10-14 15:30)이라, 실행 환경 시간대로 다시 계산하면 하루 앞 날짜가 된다.
  it("한국 시간 자정 직후 일시도 서버가 준 날짜 그대로 보여 준다(실행 환경 시간대와 무관)", () => {
    expect(applicationDate("2026-10-15T00:30:00+09:00")).toBe("2026.10.15");
  });
});

describe("applicationSessionTitle", () => {
  it("시작 날짜 'MM.DD' · 면접관 이름 · 면접 방식을 잇는다", () => {
    expect(applicationSessionTitle(session)).toBe("10.21 · 개발자 커피챗 · 채팅");
    expect(
      applicationSessionTitle({
        ...session,
        persona: "DEVIL",
        mode: "VIDEO",
        startedAt: "2026-01-05T23:50:00+09:00",
      }),
    ).toBe("01.05 · 악마 면접관 · 화상");
  });

  // UTC로는 전날(01-04 23:59)이라, 실행 환경 시간대로 다시 계산하면 하루 앞 날짜가 된다.
  it("한국 시간 오전 9시 전 시작도 서버가 준 날짜 그대로 보여 준다(실행 환경 시간대와 무관)", () => {
    expect(applicationSessionTitle({ ...session, startedAt: "2026-01-05T08:59:00+09:00" })).toBe(
      "01.05 · 개발자 커피챗 · 채팅",
    );
  });
});
