// 기준: Figma S05 Check 줄(18:2423 · 18:2434 · 18:2446 · 18:2459) · S05-E 실패 줄(18:4103) · Button 들어보기(18:2455)
// · 모션 메모 S05(18:2492: 스피너 → 초록 체크, 권한 거부 시 빨간 테두리 + 흔들림)
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CheckRow, type RowState } from "./check-row";

// 경계 mock: 연출(motion). 동작 줄이기 여부와 흔들기(useAnimate)만 대역으로 바꿔 재생 여부를 본다
const reduce = vi.hoisted(() => vi.fn());
const animate = vi.hoisted(() => vi.fn());
vi.mock("motion/react", async (importOriginal) => {
  const { useRef } = await import("react");
  return {
    ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
    useReducedMotion: reduce,
    useAnimate: () => [useRef(null), animate],
  };
});

beforeEach(() => {
  reduce.mockReturnValue(true);
});

function row(state: RowState) {
  return (
    <ul>
      <CheckRow
        icon="/devices/icon-camera.svg"
        title="카메라"
        description="얼굴이 잘 보여요"
        state={state}
      />
    </ul>
  );
}

describe("CheckRow · 장치 점검 줄", () => {
  describe("상태 변화", () => {
    it("실패로 바뀌면 그 줄을 한 번 흔든다", () => {
      reduce.mockReturnValue(false);
      const { rerender } = render(row("checking"));

      rerender(row("fail"));

      expect(animate).toHaveBeenCalledTimes(1);
    });

    it("처음부터 실패인 줄은 흔들지 않는다", () => {
      reduce.mockReturnValue(false);

      render(row("fail"));

      expect(animate).not.toHaveBeenCalled();
    });

    it("동작 줄이기면 실패로 바뀌어도 흔들지 않는다", () => {
      const { rerender } = render(row("checking"));

      rerender(row("fail"));

      expect(animate).not.toHaveBeenCalled();
    });
  });
});
