import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";

import { AttitudeTile, attitudeView } from "./attitude-tile";

// 기준: Figma 면접 태도 타일(531:2475 상태 모음 · 536:2358 / 536:2396 모바일) · AI 명세 6.3 interview.attitude

const sample = (score: number | null, receivedAt = 0) => ({ score, receivedAt });

beforeEach(() => useInterviewStore.getState().reset());
afterEach(() => {
  cleanup();
  useInterviewStore.getState().reset();
});

describe("attitudeView: 타일 상태와 보여 줄 점수", () => {
  it("답할 차례가 아니면 받은 점수가 있어도 대기다", () => {
    expect(attitudeView([sample(72)], false)).toEqual({ status: "idle", score: null });
  });
  it("답하는 중이고 마지막 점수가 있으면 측정 중이다", () => {
    expect(attitudeView([sample(null), sample(72)], true)).toEqual({
      status: "measuring",
      score: 72,
    });
  });
  it("답하는 중인데 마지막 점수가 null이면 얼굴 확인 중이고, 마지막으로 받은 숫자를 보여 준다", () => {
    expect(attitudeView([sample(72), sample(null)], true)).toEqual({
      status: "checking",
      score: 72,
    });
  });
  it("답하는 중인데 아직 점수를 받지 못했으면 얼굴 확인 중이고 숫자가 없다", () => {
    expect(attitudeView([], true)).toEqual({ status: "checking", score: null });
  });
});

describe("AttitudeTile", () => {
  const tileText = () => screen.getByRole("region", { name: "면접 태도" }).textContent ?? "";
  const open = (value: boolean) => useInterviewStore.getState().setAttitudeOpen(value);

  it("측정 중이면 점수와 '측정 중'을 보여 준다", () => {
    open(true);
    render(<AttitudeTile samples={[sample(72)]} answering />);
    expect(tileText()).toContain("72");
    expect(tileText()).toContain("측정 중");
  });
  it("대기면 숫자 대신 '–'를 보여 준다", () => {
    open(true);
    render(<AttitudeTile samples={[sample(72)]} answering={false} />);
    expect(tileText()).toContain("–");
    expect(tileText()).toContain("대기");
    expect(tileText()).not.toContain("72");
  });
  it("얼굴 확인 중이면 그 상태를 알린다", () => {
    open(true);
    render(<AttitudeTile samples={[sample(72), sample(null)]} answering />);
    expect(tileText()).toContain("얼굴 확인 중");
  });
  it("아직 누르지 않았으면 펼친 카드는 데스크톱 폭에서만, 한 줄은 모바일 폭에서만 보이게 둘 다 그린다", () => {
    render(<AttitudeTile samples={[sample(72)]} answering />);
    const collapse = screen.getByRole("button", { name: "면접 태도 접기" });
    const expand = screen.getByRole("button", { name: "면접 태도 펼치기" });
    expect(collapse.closest(String.raw`.hidden.md\:block`)).not.toBeNull();
    expect(expand.closest(String.raw`.md\:hidden`)).not.toBeNull();
  });
  it("접으면 한 줄만 남고, 다시 펼칠 수 있다", () => {
    render(<AttitudeTile samples={[sample(72)]} answering />);
    fireEvent.click(screen.getByRole("button", { name: "면접 태도 접기" }));
    expect(useInterviewStore.getState().attitudeOpen).toBe(false);
    expect(screen.queryByRole("button", { name: "면접 태도 접기" })).toBeNull();
    const expand = screen.getByRole("button", { name: "면접 태도 펼치기" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(tileText()).toContain("72");
    fireEvent.click(expand);
    expect(useInterviewStore.getState().attitudeOpen).toBe(true);
    expect(screen.queryByRole("button", { name: "면접 태도 펼치기" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "면접 태도 접기" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });
});
