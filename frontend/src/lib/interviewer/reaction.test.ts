import { describe, expect, it } from "vitest";
import type { ReactionMessage, ReactionSnapshot } from "@/lib/interview/room-messages";
import {
  reactionFrame,
  listeningNodPitch,
  LISTENING_PAUSE_MS,
  LISTENING_NOD_DURATION_MS,
} from "./reaction";

const message: ReactionMessage = {
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
const snapshot = (patch: Partial<ReactionMessage> = {}): ReactionSnapshot => ({
  receivedAt: 100,
  message: { ...message, ...patch },
});

describe("아바타 리액션 변환", () => {
  it("자동 끄덕임은 대기 뒤 한 번만 재생하고 발화 정보가 없으면 움직이지 않는다", () => {
    const activity = { questionSeq: 3, streamId: "capture-1", speechAt: 100 };
    expect(listeningNodPitch(null, 1400)).toBe(0);
    expect(listeningNodPitch(activity, 100 + LISTENING_PAUSE_MS - 1)).toBe(0);
    const start = 100 + LISTENING_PAUSE_MS;
    expect(listeningNodPitch(activity, start)).toBe(0);
    expect(listeningNodPitch(activity, start + LISTENING_NOD_DURATION_MS / 4)).toBeGreaterThan(0);
    expect(listeningNodPitch(activity, start + (LISTENING_NOD_DURATION_MS * 3) / 4)).toBeLessThan(
      0,
    );
    expect(
      Math.abs(listeningNodPitch(activity, start + LISTENING_NOD_DURATION_MS / 4)),
    ).toBeLessThan(Math.PI / 120);
    expect(listeningNodPitch(activity, start + LISTENING_NOD_DURATION_MS)).toBe(0);
    expect(listeningNodPitch(activity, start + LISTENING_NOD_DURATION_MS * 2)).toBe(0);
  });
  it.each([
    ["smile", "Smile"],
    ["frown", "Angry"],
    ["smirk", "Fun"],
  ] as const)(
    "%s를 %s 표정으로 표현하고 신뢰가 낮아도 표정을 변경하지 않는다",
    (expression, emotion) => {
      const result = reactionFrame(
        snapshot({
          reaction: {
            type: "expression",
            expression,
            gesture: null,
            intensity: 0.4,
            durationMs: 1200,
          },
          attitude: { interest: 0.5, trust: 0 },
        }),
        700,
      );
      expect(result.emotion).toBe(emotion);
      expect(result.emotionWeight).toBeCloseTo(0.4);
    },
  );
  it.each(["small_nod", "nod", "tilt"] as const)(
    "%s는 작은 동작으로 표현하고 1,200ms 뒤 원래 상태로 복귀한다",
    (gesture) => {
      const current = snapshot({
        reaction: { type: "gesture", expression: null, gesture, intensity: null, durationMs: 1200 },
      });
      const active = reactionFrame(current, 400);
      expect(Math.abs(active.pitch) + Math.abs(active.roll)).toBeGreaterThan(0);
      expect(Math.abs(active.pitch)).toBeLessThanOrEqual(Math.PI / 60);
      expect(Math.abs(active.roll)).toBeLessThanOrEqual(Math.PI / 60);
      expect(reactionFrame(current, 1300)).toEqual({
        emotion: "neutral",
        emotionWeight: 0,
        pitch: 0,
        roll: 0,
      });
    },
  );
  it("태도는 반응 구간에서만 반영하고 반응이 없으면 높은 관심·낮은 신뢰도 표시하지 않는다", () => {
    const gesture = {
      type: "gesture",
      expression: null,
      gesture: "tilt",
      intensity: null,
      durationMs: 1200,
    } as const;
    const low = reactionFrame(
      snapshot({ reaction: gesture, attitude: { interest: 1, trust: 0 } }),
      700,
    );
    const high = reactionFrame(
      snapshot({ reaction: gesture, attitude: { interest: 0, trust: 1 } }),
      700,
    );
    expect(low.pitch).toBeGreaterThan(0);
    expect(high.pitch).toBeLessThan(0);
    expect(low.emotion).toBe("Angry");
    expect(high.emotion).toBe("Smile");
    expect(low.emotionWeight).toBeCloseTo(0.15);
    expect(
      reactionFrame(snapshot({ reaction: null, attitude: { interest: 1, trust: 0 } }), 700).emotion,
    ).toBe("neutral");
  });
});
