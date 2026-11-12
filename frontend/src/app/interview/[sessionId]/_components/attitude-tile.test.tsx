// 기준: Figma 면접 태도 타일(531:2475 상태 모음 · 536:2358 / 536:2396 모바일 접힘 · 펼침) · AI 명세 6.3 interview.attitude
// · 사용자 결정(2026-11-12: 숫자 하나와 선 하나 · 최근 30초)
// 상태별 문구 · 색 · 그래프 모양은 다시 적지 않고, 상태 계산 · 숫자 대체 · 접기 · 펼치기 분기만 본다.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";

import { AttitudeTile, attitudeView } from "./attitude-tile";

const sample = (score: number | null, receivedAt = 0) => ({ score, receivedAt });

beforeEach(() => useInterviewStore.getState().reset());

describe("attitudeView · 면접 태도 타일 상태 계산", () => {
  describe("정상 처리", () => {
    it.each([
      {
        label: "답할 차례가 아니면 점수가 있어도",
        samples: [sample(72)],
        answering: false,
        expected: { status: "idle", score: null },
      },
      {
        label: "답하는 중이고 마지막 점수가 있으면",
        samples: [sample(null), sample(72)],
        answering: true,
        expected: { status: "measuring", score: 72 },
      },
      {
        label: "답하는 중인데 마지막 점수가 null이면",
        samples: [sample(72), sample(null)],
        answering: true,
        expected: { status: "checking", score: 72 },
      },
    ])("$label 상태와 마지막으로 받은 숫자를 정한다", ({ samples, answering, expected }) => {
      expect(attitudeView(samples, answering)).toEqual(expected);
    });
  });

  describe("경계값", () => {
    it("답하는 중인데 아직 점수를 받지 못했으면 얼굴 확인 중이고 숫자가 없다", () => {
      expect(attitudeView([], true)).toEqual({ status: "checking", score: null });
    });
  });
});

describe("AttitudeTile · 면접 태도 타일", () => {
  const tile = () => screen.getByRole("region", { name: "면접 태도" });

  describe("화면 표시", () => {
    it("보여 줄 숫자가 없으면(대기) 받은 점수 대신 '–'를 보인다", () => {
      useInterviewStore.getState().setAttitudeOpen(true);
      render(<AttitudeTile samples={[sample(72)]} answering={false} />);

      expect(tile().textContent).toContain("–");
      expect(tile().textContent).not.toContain("72");
    });

    it("펼침 여부를 아직 고르지 않았으면 화면 폭에 맡기도록 카드와 한 줄을 둘 다 그린다", () => {
      render(<AttitudeTile samples={[sample(72)]} answering />);

      expect(screen.getByRole("button", { name: "면접 태도 접기" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "면접 태도 펼치기" })).toBeTruthy();
    });
  });

  describe("사용자 조작", () => {
    it("[접기]를 누르면 접힌 것을 기억하고 점수가 남은 한 줄만 보인다", () => {
      render(<AttitudeTile samples={[sample(72)]} answering />);

      fireEvent.click(screen.getByRole("button", { name: "면접 태도 접기" }));

      expect(useInterviewStore.getState().attitudeOpen).toBe(false);
      expect(screen.queryByRole("button", { name: "면접 태도 접기" })).toBeNull();
      expect(tile().textContent).toContain("72");
    });

    it("접힌 한 줄에서 [펼치기]를 누르면 펼친 것을 기억하고 카드로 바꾼다", () => {
      useInterviewStore.getState().setAttitudeOpen(false);
      render(<AttitudeTile samples={[sample(72)]} answering />);

      fireEvent.click(screen.getByRole("button", { name: "면접 태도 펼치기" }));

      expect(useInterviewStore.getState().attitudeOpen).toBe(true);
      expect(screen.queryByRole("button", { name: "면접 태도 펼치기" })).toBeNull();
    });
  });
});
