// 기준: Figma S05 Mic Level(18:2388) · 모션 메모 S05(18:2492: 마이크 레벨은 실제 입력 볼륨에 맞춰 막대 높이 실시간)
import { act, render, screen } from "@testing-library/react";
import { motionValue } from "motion/react";
import { describe, expect, it } from "vitest";

import { LevelMeter } from "./level-meter";

describe("LevelMeter · 소리 크기 막대", () => {
  describe("화면 표시", () => {
    it.each([
      { level: 0.34, value: 30 },
      { level: 0.35, value: 40 },
      { level: 1, value: 100 },
    ])("소리 크기가 '$level'이면 막대 값은 '$value'이다", ({ level, value }) => {
      const sound = motionValue(0);
      render(<LevelMeter level={sound} />);

      act(() => sound.set(level));

      expect(
        (screen.getByRole("meter", { name: "마이크 소리 크기" }) as HTMLMeterElement).value,
      ).toBe(value);
    });
  });
});
