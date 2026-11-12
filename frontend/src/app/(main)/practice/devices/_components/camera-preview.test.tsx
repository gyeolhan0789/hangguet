// 기준: Figma S05 Camera Preview(18:2381) · Live Chip(18:2385) · Mic Level(18:2388)
import { render, screen } from "@testing-library/react";
import { MotionGlobalConfig, motionValue } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CameraPreview } from "./camera-preview";

// 경계 mock: 연출(motion). 녹화 점 무한 반복은 동작 줄이기와 무관해 실제 프레임을 돌지 않게 연출을 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterEach(() => {
  MotionGlobalConfig.skipAnimations = false;
});

/** 카메라 스트림 대역(영상에 연결됐는지만 본다) */
const STREAM = {} as MediaStream;

const video = () => screen.getByLabelText("내 카메라 화면") as HTMLVideoElement;

describe("CameraPreview · 카메라 미리보기", () => {
  describe("화면 표시", () => {
    it("카메라가 확인되면 영상에 스트림을 연결하고 '카메라 연결됨'을 보여 준다", () => {
      render(<CameraPreview stream={STREAM} cameraOn micOn={false} level={motionValue(0)} />);

      expect(video().srcObject).toBe(STREAM);
      expect(screen.getByText("카메라 연결됨")).toBeDefined();
    });

    it("카메라가 확인되지 않으면 영상을 숨기고 스트림을 연결하지 않는다", () => {
      render(
        <CameraPreview stream={STREAM} cameraOn={false} micOn={false} level={motionValue(0)} />,
      );

      expect(video().classList.contains("hidden")).toBe(true);
      expect(video().srcObject).toBeNull();
      expect(screen.queryByText("카메라 연결됨")).toBeNull();
    });
  });
});
