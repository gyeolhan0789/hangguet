import { describe, expect, it } from "vitest";

import { applicationEditPath, interviewerPath } from "./routes";

describe("연습 시작 단계 주소", () => {
  it("S04 면접관 선택: 지원서 id를 붙인다", () => {
    expect(interviewerPath(10)).toBe("/practice/interviewer?applicationId=10");
  });

  it("S04 [← 지원서 수정]: 그 지원서 id로 S03을 연다", () => {
    expect(applicationEditPath(10)).toBe("/practice?applicationId=10");
  });
});
