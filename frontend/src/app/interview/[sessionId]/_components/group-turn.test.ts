// 기준: API 명세 10.11 그룹 면접방 정보(phase · turn · participants · serverTime으로 deadlineAt 보정)
// · 사용자 결정(2026-11-13, 빈칸 기본안: 단계 문구)
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RoomInfoSnapshot } from "@/lib/interview/room-messages";
import type { ParticipantResponse } from "@/types/api";

import { describeTurn, formatRemaining, useRemainingSeconds } from "./group-turn";

// 예시 데이터: API 명세 10.11 면접방 정보 예시(답변자 55 · 다음 56 · 57)
function room(patch: Partial<RoomInfoSnapshot["info"]> = {}): RoomInfoSnapshot {
  return {
    offsetMs: 0,
    info: {
      turnVersion: 17,
      serverTime: "2026-11-04T14:03:00.120+09:00",
      groupStatus: "IN_PROGRESS",
      round: 2,
      phase: "ANSWERING",
      turn: {
        sessionId: 55,
        seq: 3,
        kind: "PERSONAL",
        baseIndex: 2,
        announce: "FULL",
        deadlineAt: "2026-11-04T14:05:02.000+09:00",
        extended: false,
        followupsLeft: 2,
      },
      participants: [
        { sessionId: 55, turnOrder: 1, state: "PRESENT", absentUntil: null, endReason: null },
        {
          sessionId: 56,
          turnOrder: 2,
          state: "ABSENT",
          absentUntil: "2026-11-04T14:06:00.000+09:00",
          endReason: null,
        },
        {
          sessionId: 57,
          turnOrder: 3,
          state: "ABSENT",
          absentUntil: "2026-11-04T14:04:30.000+09:00",
          endReason: null,
        },
      ],
      upcoming: [56, 57],
      ...patch,
    },
  };
}
const MEMBERS = [
  { sessionId: 55, nickname: "김하나" },
  { sessionId: 56, nickname: "이두리" },
  { sessionId: 57, nickname: "박세찬" },
] as ParticipantResponse[];

describe("describeTurn · 그룹 차례 요약", () => {
  describe("화면 표시", () => {
    it.each([
      {
        label: "질문을 준비할 때",
        me: 55,
        phase: "ASKING",
        text: "면접관이 질문을 준비하고 있어요",
      },
      { label: "질문을 말할 때", me: 55, phase: "SPEAKING", text: "면접관이 질문하고 있어요" },
      { label: "내가 답할 때", me: 55, phase: "ANSWERING", text: "내 차례예요" },
      {
        label: "다른 사람이 답할 때",
        me: 56,
        phase: "ANSWERING",
        text: "김하나 님이 답하고 있어요",
      },
      {
        label: "꼬리질문을 판단할 때",
        me: 55,
        phase: "DECIDING",
        text: "면접관이 생각하고 있어요",
      },
    ] as const)("$label 단계 문구는 '$text'다", ({ me, phase, text }) => {
      expect(describeTurn(room({ phase }), me, MEMBERS).label).toBe(text);
    });

    it("질문이 남지 않았으면(phase null) 단계 문구가 없다", () => {
      expect(describeTurn(room({ phase: null }), 55, MEMBERS).label).toBeNull();
    });

    it("방 정보를 받기 전이면 단계 문구가 없고 내 차례가 아니다", () => {
      expect(describeTurn(null, 55, MEMBERS)).toMatchObject({ label: null, myTurn: false });
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "다른 사람이 답할 때", me: 56, phase: "ANSWERING" },
      { label: "나간 사람을 기다릴 때", me: 55, phase: "WAITING" },
    ] as const)("참가자 이름을 모르면(10.4 없음) $label 단계 문구가 없다", ({ me, phase }) => {
      expect(describeTurn(room({ phase }), me, []).label).toBeNull();
    });

    it("나간 사람이 둘이면 가장 먼저 돌아와야 하는 사람(absentUntil이 이른 사람)을 기다린다고 한다", () => {
      expect(describeTurn(room({ phase: "WAITING" }), 55, MEMBERS).label).toBe(
        "박세찬 님을 기다리고 있어요",
      );
    });
  });
});

describe("useRemainingSeconds · 남은 답변 시간", () => {
  describe("시간 경과", () => {
    it("마감을 받으면 그때 시각으로 센 남은 초를 보이고, 1초가 지나면 하나 줄인다", () => {
      vi.useFakeTimers({ now: Date.parse("2026-11-04T14:05:00.000+09:00") });
      const { result } = renderHook(() => useRemainingSeconds("2026-11-04T14:05:10.000+09:00", 0));
      act(() => vi.advanceTimersByTime(0));
      expect(result.current).toBe(10);

      act(() => vi.advanceTimersByTime(1000));

      expect(result.current).toBe(9);
    });
  });

  describe("상태 변화", () => {
    it("새 마감(연장 · 다음 차례)이 오면 지난 마감 때 잰 시각이 아니라 그 순간 시각으로 다시 센다", () => {
      vi.useFakeTimers({ now: Date.parse("2026-11-04T14:05:00.000+09:00") });
      const { result, rerender } = renderHook(({ deadline }) => useRemainingSeconds(deadline, 0), {
        initialProps: { deadline: "2026-11-04T14:05:10.000+09:00" },
      });
      act(() => vi.advanceTimersByTime(500));

      rerender({ deadline: "2026-11-04T14:06:00.500+09:00" });
      expect(result.current).toBeNull();
      act(() => vi.advanceTimersByTime(0));

      expect(result.current).toBe(60);
    });
  });

  describe("경계값", () => {
    it("BE 시각이 내 시계보다 3초 빠르면 그만큼 덜 남은 것으로 센다", () => {
      vi.useFakeTimers({ now: Date.parse("2026-11-04T14:05:00.000+09:00") });
      const { result } = renderHook(() =>
        useRemainingSeconds("2026-11-04T14:05:10.000+09:00", 3000),
      );

      act(() => vi.advanceTimersByTime(0));

      expect(result.current).toBe(7);
    });

    it("마감이 지났으면 0이다", () => {
      vi.useFakeTimers({ now: Date.parse("2026-11-04T14:06:00.000+09:00") });
      const { result } = renderHook(() => useRemainingSeconds("2026-11-04T14:05:10.000+09:00", 0));

      act(() => vi.advanceTimersByTime(0));

      expect(result.current).toBe(0);
    });

    it("마감이 없으면(답변 중이 아님) null이다", () => {
      const { result } = renderHook(() => useRemainingSeconds(null, 0));

      expect(result.current).toBeNull();
    });
  });
});

describe("formatRemaining · 남은 시간 글자", () => {
  describe("정상 처리", () => {
    it.each([
      { seconds: 65, text: "1:05" },
      { seconds: 9, text: "0:09" },
    ])("$seconds초는 '$text'로 쓴다", ({ seconds, text }) => {
      expect(formatRemaining(seconds)).toBe(text);
    });
  });
});
