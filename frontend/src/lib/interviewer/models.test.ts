import { describe, expect, it } from "vitest";

import { interviewerBackdrop, interviewerLook } from "./models";

// 기준: Swagger 5.1 Persona · 기획 메모 S06(18:757: 배경 씬은 페르소나별 — 악마 = 번개 폭풍, 커피챗 = 카페 등)

describe("면접관별 3D 모델 · 배경", () => {
  it("악마 면접관은 3D 모델 · 표정 규칙 · 자세 구간 · 정지 이미지와 번개 폭풍 배경을 쓴다", () => {
    expect(interviewerLook("DEVIL")).toMatchObject({
      model: {
        glb: "/interview/devil/interviewer.glb",
        faceRules: "/interview/devil/face-rules.json",
        animation: "/interview/devil/animation.json",
      },
      still: "/interview/devil/still.webp",
      storm: "/interview/devil/storm.mp4",
      interior: "/interview/devil/office.webp",
    });
    expect(interviewerBackdrop("DEVIL")).toBe("storm");
  });

  it("커피챗 면접관은 아직 3D 모델 · 배경이 없다", () => {
    expect(interviewerLook("COFFEE_CHAT")).toBeNull();
    expect(interviewerBackdrop("COFFEE_CHAT")).toBeNull();
  });
});
