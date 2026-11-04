import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { interviewerBackdrop, interviewerLook } from "./models";

// 기준: Swagger 5.1 Persona · 기획 메모 S06(18:757: 배경 씬은 페르소나별 — 악마 = 번개 폭풍, 커피챗 = 카페 등)
// · 사용자 결정(2026-10-26: 커피챗 3D 모델 연결, 카페 실내 그림 1장 배경 · 커피챗만 따로 조명)

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
    // 폭풍 배경이 조명을 직접 바꾸므로 그림 배경 · 조명 값은 두지 않는다.
    expect(interviewerLook("DEVIL")!.background).toBeUndefined();
    expect(interviewerLook("DEVIL")!.lights).toBeUndefined();
  });

  it("악마 면접관의 모델 · 정지 그림 · 배경 파일이 public에 있다", () => {
    const look = interviewerLook("DEVIL")!;
    for (const file of [
      look.model.glb,
      look.model.faceRules,
      look.model.animation,
      look.still,
      look.storm,
      look.interior,
    ]) {
      expect(existsSync(join(process.cwd(), "public", file!)), file).toBe(true);
    }
  });

  it("커피챗 면접관은 자기 3D 모델 · 표정 규칙 · 자세 구간 · 정지 이미지와 카페 배경 그림 · 조명을 쓴다", () => {
    const look = interviewerLook("COFFEE_CHAT")!;
    expect(look).toMatchObject({
      model: {
        glb: "/interview/coffee-chat/interviewer.glb",
        faceRules: "/interview/coffee-chat/face-rules.json",
        animation: "/interview/coffee-chat/animation.json",
      },
      still: "/interview/coffee-chat/still.webp",
      background: "/interview/coffee-chat/cafe.webp",
    });
    expect(look.lights).toMatchObject({
      exposure: expect.any(Number),
      hemi: { sky: expect.any(Number), ground: expect.any(Number), intensity: expect.any(Number) },
      key: {
        color: expect.any(Number),
        intensity: expect.any(Number),
        position: expect.any(Array),
      },
      fill: {
        color: expect.any(Number),
        intensity: expect.any(Number),
        position: expect.any(Array),
      },
    });
    expect(look.storm).toBeUndefined();
    expect(look.interior).toBeUndefined();
    expect(interviewerBackdrop("COFFEE_CHAT")).toBe("cafe");
  });

  it("커피챗 면접관의 모델 · 정지 그림 · 배경 그림 파일이 public에 있다", () => {
    const look = interviewerLook("COFFEE_CHAT")!;
    for (const file of [
      look.model.glb,
      look.model.faceRules,
      look.model.animation,
      look.still,
      look.background,
    ]) {
      expect(existsSync(join(process.cwd(), "public", file!)), file).toBe(true);
    }
  });

  // 받은 비율을 이 크기로 센다(gzip 응답은 전체 크기를 알려 주지 않는다). 모델 파일을 바꾸면 크기도 같이 바꿔야 한다.
  it.each(["DEVIL", "COFFEE_CHAT", "DUCK"] as const)(
    "%s 모델의 원본 크기(glbBytes)가 public의 실제 파일 크기와 같다",
    (persona) => {
      const { model } = interviewerLook(persona)!;
      expect(model.glbBytes).toBe(statSync(join(process.cwd(), "public", model.glb)).size);
    },
  );
});
