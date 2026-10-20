import { describe, expect, it } from "vitest";

import {
  applicationEditPath,
  devicesPath,
  interviewerPath,
  interviewPath,
  modePath,
} from "./routes";

describe("연습 시작 단계 주소", () => {
  it("S04 면접관 선택: 지원서 id를 붙이고, S05-1에서 돌아갈 때는 고른 면접관도 붙인다", () => {
    expect(interviewerPath(10)).toBe("/practice/interviewer?applicationId=10");
    expect(interviewerPath(10, "DEVIL")).toBe(
      "/practice/interviewer?applicationId=10&persona=DEVIL",
    );
  });

  it("S04 [← 지원서 수정]: 그 지원서 id로 S03을 연다", () => {
    expect(applicationEditPath(10)).toBe("/practice?applicationId=10");
  });

  it("S05 장치 점검 · 면접 화면 주소에 면접 id를 붙인다", () => {
    expect(devicesPath(55)).toBe("/practice/devices?sessionId=55");
    expect(interviewPath(55)).toBe("/interview/55");
  });

  it("S05 [← 면접 방식]: 그 면접의 지원서 · 면접관으로 S05-1을 연다", () => {
    expect(modePath(10, "COFFEE_CHAT")).toBe("/practice/mode?applicationId=10&persona=COFFEE_CHAT");
  });
});
