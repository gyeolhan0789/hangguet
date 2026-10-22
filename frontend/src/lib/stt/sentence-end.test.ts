import type { RealtimeToken } from "@soniox/client";
import { describe, expect, it } from "vitest";

import {
  applySentenceResult,
  beginSentenceConnection,
  createSentenceState,
  endsWithSentenceEnding,
  handleEndpoint,
  type SentenceState,
} from "./sentence-end";

// 기준: API 명세 5.11 화상 문장 끝(<end> + 종결어미, 쉼표면 아님, 이어 붙임, pauseMs = total_audio_proc_ms − 마지막 end_ms)
// 예문은 로컬 실측(조용한 곳)에서 끝 감지가 발생한 글이다.

function token(text: string, endMs: number | undefined, isFinal = true): RealtimeToken {
  return {
    text,
    start_ms: endMs === undefined ? undefined : endMs - 100,
    end_ms: endMs,
    confidence: 1,
    is_final: isFinal,
  };
}

/** 확정 토큰 하나로 된 result를 반영한 상태 */
function heard(text: string, endMs = 1_000, state: SentenceState = createSentenceState()) {
  return applySentenceResult(state, [token(text, endMs)]);
}

describe("endsWithSentenceEnding (종결어미)", () => {
  it.each([
    ["경험입니다."],
    ["찾았습니다."],
    ["줄였어요."],
    ["될까요?"],
    ["그렇죠"],
    ["했습니다!"],
    ["했습니다..."],
    ["했습니다… "],
  ])("%s: 문장 끝", (text) => {
    expect(endsWithSentenceEnding(text)).toBe(true);
  });

  it.each([["음."], ["몰랐는데,"], ["결과."], ["줄였습니다,"], [""], ["   "]])(
    "%s: 문장 끝 아님",
    (text) => {
      expect(endsWithSentenceEnding(text)).toBe(false);
    },
  );
});

describe("handleEndpoint (끝 감지)", () => {
  it("종결어미로 끝나면 문장을 반환하고 글을 초기화하며, pauseMs는 total_audio_proc_ms − 마지막 end_ms다", () => {
    const state = heard(" 경험입니다.", 2_000);

    const { state: next, sentence } = handleEndpoint(state, 3_150);

    expect(sentence).toEqual({ text: "경험입니다.", pauseMs: 1_150 });
    expect(next).toEqual(createSentenceState());
  });

  it("종결어미로 끝나지 않으면 전송하지 않고 다음 끝 감지까지 이어 붙인다", () => {
    let state = heard(" 몰랐는데,", 1_000);
    const first = handleEndpoint(state, 4_000);
    expect(first.sentence).toBeNull();

    state = applySentenceResult(first.state, [token(" 결국", 5_000), token(" 찾았습니다.", 5_600)]);
    const second = handleEndpoint(state, 6_700);

    expect(second.sentence).toEqual({ text: "몰랐는데, 결국 찾았습니다.", pauseMs: 1_100 });
  });

  it.each([["음."], ["결과."]])("%s: 끝 감지가 발생해도 문장 끝이 아니다", (text) => {
    expect(handleEndpoint(heard(text), 2_000).sentence).toBeNull();
  });

  it("미확정 토큰이 남아 있으면 종결어미로 끝나도 문장 끝이 아니다", () => {
    const state = applySentenceResult(createSentenceState(), [
      token("줄였어요.", 1_000),
      token(" 그리고", 1_300, false),
    ]);

    expect(handleEndpoint(state, 2_000).sentence).toBeNull();
  });

  it("미확정 토큰은 글에 포함하지 않는다(미확정 글이 종결어미로 끝나도 문장 끝 아님)", () => {
    const state = applySentenceResult(createSentenceState(), [
      token("그래서", 1_000),
      token(" 줄였어요.", 1_400, false),
    ]);

    expect(state.text).toBe("그래서");
    expect(handleEndpoint(state, 2_000).sentence).toBeNull();
  });

  it("pauseMs가 음수가 되면 0이다", () => {
    expect(handleEndpoint(heard("됐어요.", 2_000), 1_900).sentence?.pauseMs).toBe(0);
  });

  it("마지막 비공백 토큰의 end_ms를 사용한다(뒤에 오는 공백 · 시각 없는 토큰은 무시)", () => {
    const state = applySentenceResult(createSentenceState(), [
      token("됐어요.", 1_000),
      token(" ", 1_500),
      token("", undefined),
    ]);

    expect(handleEndpoint(state, 1_800).sentence?.pauseMs).toBe(800);
  });

  it("새 연결 뒤에는 앞 연결의 end_ms를 폐기해 pauseMs를 0으로 전송하고 글은 유지한다", () => {
    const before = handleEndpoint(heard("그래서", 9_000), 10_000).state;

    const state = beginSentenceConnection(before);
    expect(state.text).toBe("그래서");
    expect(handleEndpoint(state, 500).sentence).toBeNull();
    const after = applySentenceResult(state, [token(" 줄였어요.", 400)]);

    expect(handleEndpoint(after, 1_000).sentence).toEqual({
      text: "그래서 줄였어요.",
      pauseMs: 600,
    });
    expect(handleEndpoint(beginSentenceConnection(heard("됐어요.")), 5_000).sentence?.pauseMs).toBe(
      0,
    );
  });

  it("전송하는 문장은 앞뒤 공백을 제거하고, 빈 글은 전송하지 않는다", () => {
    const state: SentenceState = { text: "  다", lastEndMs: null, pending: false };
    expect(handleEndpoint(state, 0).sentence).toEqual({ text: "다", pauseMs: 0 });
    expect(handleEndpoint(createSentenceState(), 0).sentence).toBeNull();
  });

  it("1,000자를 넘으면 문장 끝 쪽 1,000자만 전송한다(FE 임시 처리)", () => {
    const long = "가".repeat(1_200) + "습니다.";

    const sentence = handleEndpoint(heard(long), 2_000).sentence;

    expect(sentence?.text).toHaveLength(1_000);
    expect(sentence?.text.endsWith("습니다.")).toBe(true);
  });
});
