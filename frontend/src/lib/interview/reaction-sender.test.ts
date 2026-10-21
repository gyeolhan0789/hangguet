import { describe, expect, it, vi } from "vitest";

import type { ReactionResponse } from "@/types/api";

import type { ReactionActionResult } from "./actions";
import { createReactionSender } from "./reaction-sender";

// 기준: API 명세 5.11(seq 1부터, 가장 큰 seq만, ttlMs가 경과한 뒤 도착 · 5.7 뒤 도착은 폐기, 실패면 리액션 없이 진행)

function response(seq: number, ttlMs: number | null = 3_000): ReactionResponse {
  return {
    seq,
    reaction:
      ttlMs === null
        ? null
        : {
            type: "gesture",
            state: null,
            expression: null,
            gesture: "nod",
            intensity: 0.6,
            durationMs: 1_200,
            ttlMs,
            source: "server",
          },
    attitude: { interest: 0.5, trust: 0.6, tension: 0.2 },
    interrupt: null,
  };
}

/** 응답을 직접 resolve할 수 있는 5.11 */
function controlledRequest() {
  const pending = new Map<number, (result: ReactionActionResult) => void>();
  const request = vi.fn(
    (seq: number) =>
      new Promise<ReactionActionResult>((resolve) => {
        pending.set(seq, resolve);
      }),
  );
  const answer = async (seq: number, result: ReactionActionResult) => {
    pending.get(seq)?.(result);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { request, answer };
}

const sentence = (text: string) => ({ text, pauseMs: 400 });

describe("createReactionSender", () => {
  it("문장마다 seq를 1부터 증가시켜 전송한다", () => {
    const { request } = controlledRequest();
    const sender = createReactionSender({ request, onReaction: vi.fn() });

    sender.send(sentence("경험입니다."));
    sender.send(sentence("줄였어요."));

    expect(request.mock.calls).toEqual([
      [1, sentence("경험입니다.")],
      [2, sentence("줄였어요.")],
    ]);
  });

  it("응답 순서가 변경되면 더 큰 seq를 수신한 뒤 도착한 작은 seq는 폐기한다", async () => {
    const { request, answer } = controlledRequest();
    const onReaction = vi.fn();
    const sender = createReactionSender({ request, onReaction });
    sender.send(sentence("a다."));
    sender.send(sentence("b다."));

    await answer(2, { ok: true, ...response(2) });
    await answer(1, { ok: true, ...response(1) });

    expect(onReaction.mock.calls.map(([r]) => r.seq)).toEqual([2]);
  });

  it("요청 후 ttlMs가 경과한 뒤 도착한 응답은 폐기한다", async () => {
    let now = 0;
    const { request, answer } = controlledRequest();
    const onReaction = vi.fn();
    const sender = createReactionSender({ request, onReaction, now: () => now });

    sender.send(sentence("a다."));
    now = 3_001;
    await answer(1, { ok: true, ...response(1, 3_000) });
    sender.send(sentence("b다."));
    now = 6_001;
    await answer(2, { ok: true, ...response(2, 3_000) });

    expect(onReaction.mock.calls.map(([r]) => r.seq)).toEqual([2]);
  });

  it("reaction이 null이어도(서버가 정하지 못함) 태도 · 말 끊기는 전달한다", async () => {
    const { request, answer } = controlledRequest();
    const onReaction = vi.fn();
    createReactionSender({ request, onReaction }).send(sentence("a다."));

    await answer(1, { ok: true, ...response(1, null) });

    expect(onReaction).toHaveBeenCalledWith(response(1, null));
  });

  it("중지한 뒤에는 전송하지 않고, 이미 전송한 요청의 응답도 폐기한다(5.7을 제출한 뒤 도착)", async () => {
    const { request, answer } = controlledRequest();
    const onReaction = vi.fn();
    const sender = createReactionSender({ request, onReaction });
    sender.send(sentence("a다."));

    sender.stop();
    sender.send(sentence("b다."));
    await answer(1, { ok: true, ...response(1) });

    expect(request).toHaveBeenCalledTimes(1);
    expect(onReaction).not.toHaveBeenCalled();
  });

  it.each([
    { ok: false, code: "ANSWER_ALREADY_SUBMITTED", status: 409 },
    { ok: false, code: null, status: 502 },
  ] satisfies ReactionActionResult[])("실패($status)면 리액션 없이 진행한다", async (failure) => {
    const { request, answer } = controlledRequest();
    const onReaction = vi.fn();
    createReactionSender({ request, onReaction }).send(sentence("a다."));

    await answer(1, failure);

    expect(onReaction).not.toHaveBeenCalled();
  });

  it("서버 액션 호출 자체가 실패해도 예외를 발생시키지 않는다", async () => {
    const onReaction = vi.fn();
    const sender = createReactionSender({
      request: () => Promise.reject(new Error("network")),
      onReaction,
    });

    expect(() => sender.send(sentence("a다."))).not.toThrow();
    await Promise.resolve();
    expect(onReaction).not.toHaveBeenCalled();
  });
});
