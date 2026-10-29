import { describe, expect, it } from "vitest";

import {
  applicationNewPath,
  applicationPath,
  applicationsPath,
  devicesPath,
  interviewerPath,
  interviewPath,
  modePath,
  practiceSelectPath,
  recordsPath,
} from "./routes";

describe("연습 시작 단계 주소", () => {
  it("S04 면접관 선택: 지원서 id를 붙이고, S05-1에서 돌아갈 때는 고른 면접관도 붙인다", () => {
    expect(interviewerPath(10)).toBe("/practice/interviewer?applicationId=10");
    expect(interviewerPath(10, "DEVIL")).toBe(
      "/practice/interviewer?applicationId=10&persona=DEVIL",
    );
  });

  it("S03 지원서 선택: 골라 둘 지원서 id를 붙이고, 지원서 쓰기에서 막 저장했으면 added=1도 붙인다", () => {
    expect(practiceSelectPath(10)).toBe("/practice?applicationId=10");
    expect(practiceSelectPath(10, true)).toBe("/practice?applicationId=10&added=1");
  });

  it("S05 장치 점검 · 면접 화면 주소에 면접 id를 붙인다", () => {
    expect(devicesPath(55)).toBe("/practice/devices?sessionId=55");
    expect(interviewPath(55)).toBe("/interview/55");
  });

  it("S05 [← 면접 방식]: 그 면접의 지원서 · 면접관으로 S05-1을 연다", () => {
    expect(modePath(10, "COFFEE_CHAT")).toBe("/practice/mode?applicationId=10&persona=COFFEE_CHAT");
  });
});

describe("연습 기록 주소", () => {
  it("날짜(date)를 붙이고, 첫 페이지가 아니면 page도 붙인다", () => {
    expect(recordsPath("2026-10-21")).toBe("/records?date=2026-10-21");
    expect(recordsPath("2026-10-21", 0)).toBe("/records?date=2026-10-21");
    expect(recordsPath("2026-10-21", 2)).toBe("/records?date=2026-10-21&page=2");
  });
});

describe("지원 관리 주소", () => {
  it("목록: 첫 페이지가 아니면 page를 붙인다", () => {
    expect(applicationsPath()).toBe("/applications");
    expect(applicationsPath(0)).toBe("/applications");
    expect(applicationsPath(2)).toBe("/applications?page=2");
  });

  it("상세: 지원서 id를 경로에 붙이고, 면접 기록이 첫 쪽이 아니면 page를 붙인다", () => {
    expect(applicationPath(10)).toBe("/applications/10");
    expect(applicationPath(10, 0)).toBe("/applications/10");
    expect(applicationPath(10, 2)).toBe("/applications/10?page=2");
  });

  it("지원서 쓰기: S03에서 열 때만 from=practice를 붙인다", () => {
    expect(applicationNewPath()).toBe("/applications/new");
    expect(applicationNewPath("applications")).toBe("/applications/new");
    expect(applicationNewPath("practice")).toBe("/applications/new?from=practice");
  });
});
