// @vitest-environment node
// 기준: Figma 화면 번호(S03 · S04 · S07-1 · 지원 관리 · 연습 기록 · I02) · 모션 메모 S03 지원서 선택 · 사용자 결정(2026-10-29 지원서 쓰기 from)
import { describe, expect, it } from "vitest";

import {
  applicationNewPath,
  applicationPath,
  applicationsPath,
  inquiriesPath,
  interviewerPath,
  practiceSelectPath,
  recordsPath,
  replayPath,
} from "./routes";

describe("interviewerPath · S04 면접관 선택 주소", () => {
  describe("정상 처리", () => {
    it.each([
      {
        label: "있음",
        persona: "DEVIL",
        expected: "/practice/interviewer?applicationId=12&persona=DEVIL",
      },
      { label: "없음", persona: undefined, expected: "/practice/interviewer?applicationId=12" },
    ] as const)("고른 면접관이 '$label'이면 '$expected'다", ({ persona, expected }) => {
      expect(interviewerPath(12, persona)).toBe(expected);
    });
  });
});

describe("replayPath · 면접 다시보기 주소", () => {
  describe("정상 처리", () => {
    it.each([
      { label: "있음", seq: 3, expected: "/interview/55/replay?q=3" },
      { label: "없음", seq: undefined, expected: "/interview/55/replay" },
    ])("질문 순서가 '$label'이면 '$expected'다", ({ seq, expected }) => {
      expect(replayPath(55, seq)).toBe(expected);
    });
  });

  describe("경계값", () => {
    it("질문 순서가 0이어도 q로 붙인다", () => {
      expect(replayPath(55, 0)).toBe("/interview/55/replay?q=0");
    });
  });
});

describe("practiceSelectPath · S03 지원서 선택 주소", () => {
  describe("정상 처리", () => {
    it.each([
      { added: true, expected: "/practice?applicationId=12&added=1" },
      { added: false, expected: "/practice?applicationId=12" },
    ])("막 저장하고 돌아온 여부가 '$added'면 '$expected'다", ({ added, expected }) => {
      expect(practiceSelectPath(12, added)).toBe(expected);
    });
  });
});

describe("applicationsPath · 지원 관리 목록 주소", () => {
  describe("경계값", () => {
    it.each([
      { page: 0, expected: "/applications" },
      { page: 1, expected: "/applications?page=1" },
    ])("페이지가 '$page'이면 '$expected'다", ({ page, expected }) => {
      expect(applicationsPath(page)).toBe(expected);
    });
  });
});

describe("applicationPath · 지원서 상세 주소", () => {
  describe("경계값", () => {
    it.each([
      { page: 0, expected: "/applications/12" },
      { page: 2, expected: "/applications/12?page=2" },
    ])("면접 기록 쪽이 '$page'이면 '$expected'다", ({ page, expected }) => {
      expect(applicationPath(12, page)).toBe(expected);
    });
  });
});

describe("applicationNewPath · 지원서 쓰기 주소", () => {
  describe("정상 처리", () => {
    it.each([
      { from: "practice", expected: "/applications/new?from=practice" },
      { from: "applications", expected: "/applications/new" },
    ] as const)("연 곳이 '$from'이면 '$expected'다", ({ from, expected }) => {
      expect(applicationNewPath(from)).toBe(expected);
    });
  });
});

describe("recordsPath · 연습 기록 주소", () => {
  describe("경계값", () => {
    it.each([
      { page: 0, expected: "/records?date=2026-11-12" },
      { page: 3, expected: "/records?date=2026-11-12&page=3" },
    ])("페이지가 '$page'이면 '$expected'다", ({ page, expected }) => {
      expect(recordsPath("2026-11-12", page)).toBe(expected);
    });
  });
});

describe("inquiriesPath · 내 문의 목록 주소", () => {
  describe("경계값", () => {
    it.each([
      { page: 0, expected: "/inquiries" },
      { page: 1, expected: "/inquiries?page=1" },
    ])("페이지가 '$page'이면 '$expected'다", ({ page, expected }) => {
      expect(inquiriesPath(page)).toBe(expected);
    });
  });
});
