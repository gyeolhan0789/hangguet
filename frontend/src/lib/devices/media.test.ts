import { describe, expect, it } from "vitest";

import { mediaFailure, micLevel } from "./media";

// 기준: MDN getUserMedia Exceptions · Figma S05-E(권한 거부 → '권한이 없어요')
describe("mediaFailure (getUserMedia 오류 → 체크 줄 상태)", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "missing"],
    ["OverconstrainedError", "missing"],
    ["NotReadableError", "busy"],
    ["AbortError", "busy"],
    ["NotSupportedError", "unsupported"],
  ] as const)("%s → %s", (name, expected) => {
    expect(mediaFailure(new DOMException("실패", name))).toBe(expected);
  });

  it("HTTPS가 아니어서 mediaDevices가 없을 때(TypeError) · 오류가 아닌 값은 unsupported", () => {
    expect(mediaFailure(new TypeError("getUserMedia를 쓸 수 없어요"))).toBe("unsupported");
    expect(mediaFailure("문자열")).toBe("unsupported");
  });
});

// 기준: 모션 메모 S05(마이크 레벨은 실제 입력 볼륨에 맞춰 막대 높이 실시간)
describe("micLevel (소리 크기 0~1)", () => {
  /** 크기가 amplitude인 사인파 한 주기 */
  const sine = (amplitude: number) =>
    Array.from({ length: 1024 }, (_, i) => amplitude * Math.sin((2 * Math.PI * i) / 1024));

  it("무음 · 빈 입력은 0", () => {
    expect(micLevel(new Float32Array(1024))).toBe(0);
    expect(micLevel([])).toBe(0);
  });

  it("-60dB 이하는 0, -10dB 이상은 1로 자른다", () => {
    // 사인파 RMS = 진폭 / √2
    expect(micLevel(sine(0.0005))).toBe(0);
    expect(micLevel(sine(1))).toBe(1);
  });

  it("그 사이는 dB에 비례한다(-35dB → 0.5)", () => {
    const rms = 10 ** (-35 / 20);
    expect(micLevel(sine(rms * Math.SQRT2))).toBeCloseTo(0.5, 5);
  });
});
