import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModeIcon } from "./mode-icon";

// 기준: 모션 메모 S05-1(18:2328) "고른 카드만 재생, 해제되면 정지 · 화상: 빨간 녹화 점 반복 · 채팅: 점 3개 타이핑 반복
// · useReducedMotion() = true면 루프 없이 색만 바뀜". 반복 연출 요소가 언제 있고 없는지를 본다
// (움직임의 실제 키프레임 · GPU 합성은 브라우저에서만 보이므로 여기서는 보지 않는다).
// 장식 요소라 역할 · 이름이 없어 data-testid로 찾는다.

let reduce = false;
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reduce,
}));

afterEach(() => {
  cleanup();
  reduce = false;
});

describe("ModeIcon (면접 방식 아이콘 연출)", () => {
  it("고른 화상 카드면 녹화 점이 깜빡이고, 타이핑 점은 없다", () => {
    render(<ModeIcon mode="VIDEO" active />);

    expect(screen.getByTestId("recording-dot")).toBeDefined();
    expect(screen.queryAllByTestId("typing-dot")).toHaveLength(0);
  });

  it("고른 채팅 카드면 말풍선 안 점 3개가 타이핑하고, 녹화 점은 없다", () => {
    render(<ModeIcon mode="CHAT" active />);

    expect(screen.getAllByTestId("typing-dot")).toHaveLength(3);
    expect(screen.queryByTestId("recording-dot")).toBeNull();
  });

  it("고르지 않은 카드는 반복 연출이 없고, 고른 상태가 풀리면 멈춘다", () => {
    const { rerender } = render(<ModeIcon mode="CHAT" active />);
    expect(screen.getAllByTestId("typing-dot")).toHaveLength(3);

    rerender(<ModeIcon mode="CHAT" active={false} />);

    expect(screen.queryAllByTestId("typing-dot")).toHaveLength(0);
  });

  it.each(["VIDEO", "CHAT"] as const)("동작 줄이기면 %s를 골라도 반복 연출이 없다", (mode) => {
    reduce = true;
    render(<ModeIcon mode={mode} active />);

    expect(screen.queryByTestId("recording-dot")).toBeNull();
    expect(screen.queryAllByTestId("typing-dot")).toHaveLength(0);
  });
});
