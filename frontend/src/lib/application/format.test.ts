// @vitest-environment node
// 기준: Figma 지원 관리 · 목록 · 상세(작성일 'YYYY.MM.DD') · 지원 관리 · 상세 · 면접에 씀(면접 기록 줄 '10.21 · 개발자 커피챗 · 채팅')
// · Swagger 4.2 createdAt · 4.6 startedAt · persona · mode
import { describe, expect, it } from "vitest";

import type { SessionListItem } from "@/types/api";

import { applicationDate, applicationSessionTitle } from "./format";

// 예시 데이터: Swagger 4.6 200 '분석 중·실패' 예시의 첫 줄
const SESSION: SessionListItem = {
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
};

describe("applicationDate · 지원서 작성일", () => {
  describe("정상 처리", () => {
    it("서버 일시를 'YYYY.MM.DD'로 바꾼다", () => {
      expect(applicationDate("2026-10-15T11:55:00+09:00")).toBe("2026.10.15");
    });
  });
});

describe("applicationSessionTitle · 면접 기록 줄 제목", () => {
  describe("정상 처리", () => {
    it("시작 날짜 'MM.DD' · 면접관 이름 · 면접 방식을 ' · '로 잇는다", () => {
      expect(applicationSessionTitle(SESSION)).toBe("10.21 · 개발자 커피챗 · 채팅");
    });
  });
});
