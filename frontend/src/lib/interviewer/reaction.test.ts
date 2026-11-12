// @vitest-environment node
// 기준: AI 명세 6.3 reaction(expression · gesture · intensity · durationMs · attitude)
// · API 명세 면접방 메시지(오리 면접관은 smile · small_nod · nod만 표시, attitude를 부정적인 표정으로 반영하지 않음)
import { describe, expect, it } from "vitest";

import type { ReactionMessage, ReactionSnapshot } from "@/lib/interview/room-messages";

import { gentleReaction, isNodReaction, listeningNodPitch, reactionFrame } from "./reaction";

// 예시 데이터: AI 명세 6.3 reaction 예시(100ms에 받음, 1,200ms 동안 표시 — 가운데 시점은 700ms)
const SMILE: ReactionMessage = {
  type: "reaction",
  sessionId: 55,
  questionSeq: 3,
  seq: 1,
  reaction: {
    type: "expression",
    expression: "smile",
    gesture: null,
    intensity: 0.4,
    durationMs: 1200,
  },
  attitude: { interest: 0.5, trust: 0.5 },
  interrupt: null,
};
const MIDDLE = 700;
const NEUTRAL = { emotion: "neutral", emotionWeight: 0, pitch: 0, roll: 0 };

function snapshot(patch: Partial<ReactionMessage> = {}): ReactionSnapshot {
  return { receivedAt: 100, message: { ...SMILE, ...patch } };
}
function expression(name: "smile" | "frown" | "smirk"): ReactionMessage["reaction"] {
  return { type: "expression", expression: name, gesture: null, intensity: 0.4, durationMs: 1200 };
}
function gesture(name: "small_nod" | "nod" | "tilt"): ReactionMessage["reaction"] {
  return { type: "gesture", expression: null, gesture: name, intensity: null, durationMs: 1200 };
}

describe("listeningNodPitch · 듣는 중 끄덕임 각도", () => {
  const activity = { questionSeq: 3, streamId: "capture-1", speechAt: 100 };

  describe("정상 처리", () => {
    it("말이 멈추고 1초 뒤부터 1.2초 동안 pitch를 + 쪽으로 갔다가 − 쪽으로 돌아온다", () => {
      expect(listeningNodPitch(activity, 100 + 1000 + 300)).toBeGreaterThan(0);
      expect(listeningNodPitch(activity, 100 + 1000 + 900)).toBeLessThan(0);
    });
  });

  describe("입력 검증", () => {
    it("발화 정보가 없으면 0을 돌려준다", () => {
      expect(listeningNodPitch(null, 1400)).toBe(0);
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "대기 중(999ms)", elapsed: 999 },
      { label: "끝난 시각(2,200ms)", elapsed: 2200 },
    ])("'$label'이면 0을 돌려준다", ({ elapsed }) => {
      expect(listeningNodPitch(activity, 100 + elapsed)).toBe(0);
    });
  });
});

describe("gentleReaction · 오리 면접관 반응 거르기", () => {
  describe("정상 처리", () => {
    it.each([
      { label: "smile", reaction: expression("smile") },
      { label: "nod", reaction: gesture("nod") },
    ])("'$label'이면 반응을 남긴다", ({ reaction }) => {
      const current = snapshot({ reaction });

      expect(gentleReaction(current)).toEqual(current);
    });

    it.each([
      { trust: 0.3, expected: 0.5 },
      { trust: 0.7, expected: 0.7 },
    ])("신뢰가 '$trust'이면 $expected로 둔다", ({ trust, expected }) => {
      const current = snapshot({ attitude: { interest: 0.5, trust } });

      expect(gentleReaction(current)?.message.attitude).toEqual({ interest: 0.5, trust: expected });
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "frown", reaction: expression("frown") },
      { label: "tilt", reaction: gesture("tilt") },
    ])("'$label'이면 null을 돌려준다", ({ reaction }) => {
      expect(gentleReaction(snapshot({ reaction }))).toBeNull();
    });

    it.each([
      { label: "스냅샷 없음", current: null },
      { label: "반응 없음", current: snapshot({ reaction: null }) },
    ])("'$label'이면 null을 돌려준다", ({ current }) => {
      expect(gentleReaction(current)).toBeNull();
    });
  });
});

describe("isNodReaction · 끄덕임 반응인지", () => {
  describe("정상 처리", () => {
    it.each([
      { label: "small_nod", current: snapshot({ reaction: gesture("small_nod") }), expected: true },
      { label: "nod", current: snapshot({ reaction: gesture("nod") }), expected: true },
      { label: "tilt", current: snapshot({ reaction: gesture("tilt") }), expected: false },
      { label: "표정", current: snapshot(), expected: false },
      { label: "없음", current: null, expected: false },
    ])("'$label'이면 $expected를 돌려준다", ({ current, expected }) => {
      expect(isNodReaction(current)).toBe(expected);
    });
  });
});

describe("reactionFrame · 리액션 한 프레임", () => {
  describe("정상 처리", () => {
    it.each([
      { name: "smile", emotion: "Smile" },
      { name: "frown", emotion: "Angry" },
      { name: "smirk", emotion: "Fun" },
    ] as const)(
      "표정 '$name'을 $emotion 감정으로 바꾸고 가운데 시점에 intensity 세기로 둔다",
      ({ name, emotion }) => {
        const frame = reactionFrame(snapshot({ reaction: expression(name) }), MIDDLE);

        expect(frame.emotion).toBe(emotion);
        expect(frame.emotionWeight).toBeCloseTo(0.4);
      },
    );

    it("smirk는 고개를 반만 갸웃한다", () => {
      const frame = reactionFrame(snapshot({ reaction: expression("smirk") }), MIDDLE);

      expect(frame.roll).toBeCloseTo(Math.PI / 120);
    });

    it.each([
      { label: "낮으면", trust: 0.25, emotion: "Angry", weight: 0.075 },
      { label: "높으면", trust: 1, emotion: "Smile", weight: 0.15 },
    ])(
      "몸짓 반응은 신뢰가 '$label' $emotion을 신뢰 차의 0.15배 세기로 둔다",
      ({ trust, emotion, weight }) => {
        const frame = reactionFrame(
          snapshot({ reaction: gesture("tilt"), attitude: { interest: 0.5, trust } }),
          MIDDLE,
        );

        expect(frame.emotion).toBe(emotion);
        expect(frame.emotionWeight).toBeCloseTo(weight);
      },
    );

    it("tilt는 고개를 갸웃한다", () => {
      const frame = reactionFrame(snapshot({ reaction: gesture("tilt") }), MIDDLE);

      expect(frame.roll).toBeCloseTo(Math.PI / 60);
      expect(frame.pitch).toBeCloseTo(0);
    });

    it("small_nod는 nod의 절반 크기로 끄덕인다", () => {
      const nod = reactionFrame(snapshot({ reaction: gesture("nod") }), 400);
      const small = reactionFrame(snapshot({ reaction: gesture("small_nod") }), 400);

      expect(nod.pitch).toBeGreaterThan(0);
      expect(small.pitch).toBeCloseTo(nod.pitch / 2);
    });

    it("관심이 높으면 pitch를 +, 낮으면 −로 둔다", () => {
      const high = reactionFrame(snapshot({ attitude: { interest: 1, trust: 0.5 } }), MIDDLE);
      const low = reactionFrame(snapshot({ attitude: { interest: 0, trust: 0.5 } }), MIDDLE);

      expect(high.pitch).toBeCloseTo(Math.PI / 180);
      expect(low.pitch).toBeCloseTo(-Math.PI / 180);
    });
  });

  describe("입력 검증", () => {
    it("반응이 없으면 관심 · 신뢰와 상관없이 중립이다", () => {
      expect(
        reactionFrame(snapshot({ reaction: null, attitude: { interest: 1, trust: 0 } }), MIDDLE),
      ).toEqual(NEUTRAL);
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "받기 전", now: 99 },
      { label: "durationMs가 다 찬 시각", now: 100 + 1200 },
    ])("'$label'이면 중립이다", ({ now }) => {
      expect(reactionFrame(snapshot(), now)).toEqual(NEUTRAL);
    });
  });
});
