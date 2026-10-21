import type { RealtimeToken } from "@soniox/client";
import { describe, expect, it } from "vitest";

import {
  applyResult,
  beginConnection,
  createTranscript,
  getCaption,
  getContent,
  toAnswerTokens,
  type Transcript,
} from "./transcript";

// 기준: API 명세 5.7(확정 토큰을 그대로, <end> · <fin> 제외, 시각은 파일 시작 기준 + 연결마다 offset(음수 가능), tokens 400 조건)

function token(
  text: string,
  startMs: number | undefined,
  endMs: number | undefined,
  isFinal = true,
): RealtimeToken {
  return { text, start_ms: startMs, end_ms: endMs, confidence: 1, is_final: isFinal };
}

/** offset으로 연결을 시작하고 result를 차례로 반영한다 */
function connected(offsetMs: number | null, ...results: RealtimeToken[][]): Transcript {
  return results.reduce(applyResult, beginConnection(createTranscript(), offsetMs));
}

describe("applyResult (확정 · 미확정)", () => {
  it("확정 토큰은 result마다 이어 붙인다", () => {
    const transcript = connected(0, [token("안녕", 0, 300)], [token("하세요", 300, 600)]);

    expect(getContent(transcript)).toBe("안녕하세요");
  });

  it("미확정 글은 result마다 전체가 변경되고 content에는 포함되지 않는다", () => {
    const transcript = connected(
      0,
      [token("저는", 0, 300), token(" 개", 300, 400, false)],
      [token(" 개발자", 300, 700, false)],
    );

    expect(getCaption(transcript)).toBe("저는 개발자");
    expect(getContent(transcript)).toBe("저는");
  });

  it("<end> · <fin> 표시 토큰은 글 · 자막 · tokens에서 제외한다", () => {
    const transcript = connected(0, [
      token("네", 0, 200),
      token("<end>", 200, 200),
      token("<fin>", 200, 200),
      token("<end>", 200, 200, false),
    ]);

    expect(getContent(transcript)).toBe("네");
    expect(getCaption(transcript)).toBe("네");
    expect(toAnswerTokens(transcript)).toEqual([{ text: "네", startMs: 0, endMs: 200 }]);
  });

  it("공백은 별도로 도착한 토큰(' ')이든 앞에 붙은 토큰(' are')이든 유지하고, content만 앞뒤를 제거한다", () => {
    const transcript = connected(0, [
      token(" ", 0, 10),
      token("How", 10, 200),
      token(" ", 200, 210),
      token("are", 210, 400),
      token(" you", 400, 600),
      token(" ", 600, 610),
    ]);

    expect(getContent(transcript)).toBe("How are you");
    expect(toAnswerTokens(transcript)?.map((each) => each.text)).toEqual([
      " ",
      "How",
      " ",
      "are",
      " you",
      " ",
    ]);
  });
});

describe("toAnswerTokens (시각 보정)", () => {
  it("양수 offset을 더한다", () => {
    expect(toAnswerTokens(connected(300, [token("네", 100, 200)]))).toEqual([
      { text: "네", startMs: 400, endMs: 500 },
    ]);
  });

  it("음수 offset도 폐기하지 않고 더한다", () => {
    expect(toAnswerTokens(connected(-50, [token("네", 100, 200)]))).toEqual([
      { text: "네", startMs: 50, endMs: 150 },
    ]);
  });

  it("offset을 더한 뒤 밀리초로 반올림한다", () => {
    expect(toAnswerTokens(connected(10.6, [token("네", 100, 200)]))).toEqual([
      { text: "네", startMs: 111, endMs: 211 },
    ]);
  });

  it("연결이 둘이면 토큰마다 수신한 연결의 offset을 더하고, 앞 연결의 미확정 글은 폐기한다", () => {
    const first = connected(200, [token("첫", 0, 100), token(" 미확정", 100, 300, false)]);
    const second = applyResult(beginConnection(first, 5000), [token(" 둘째", 0, 150)]);

    expect(getCaption(second)).toBe("첫 둘째");
    expect(toAnswerTokens(second)).toEqual([
      { text: "첫", startMs: 200, endMs: 300 },
      { text: " 둘째", startMs: 5000, endMs: 5150 },
    ]);
  });

  it("확정 토큰이 정확히 10,000개면 전송한다", () => {
    const tokens = Array.from({ length: 10_000 }, (_, i) => token("가", i, i + 1));

    expect(toAnswerTokens(connected(0, tokens))).toHaveLength(10_000);
  });
});

describe("toAnswerTokens (5.7 400 조건이면 tokens 전체를 전송하지 않음)", () => {
  it.each([
    {
      name: "offset을 더한 startMs가 0 미만",
      transcript: connected(-200, [token("네", 100, 300)]),
    },
    { name: "endMs < startMs", transcript: connected(0, [token("네", 300, 200)]) },
    { name: "start_ms 없음", transcript: connected(0, [token("네", undefined, 200)]) },
    { name: "end_ms 없음", transcript: connected(0, [token("네", 100, undefined)]) },
    { name: "offset을 모름", transcript: connected(null, [token("네", 100, 200)]) },
    { name: "빈 text", transcript: connected(0, [token("", 100, 200)]) },
    {
      name: "10,000개 초과",
      transcript: connected(
        0,
        Array.from({ length: 10_001 }, (_, i) => token("가", i, i + 1)),
      ),
    },
  ])("$name: 하나만 걸려도 null", ({ transcript }) => {
    const valid = applyResult(beginConnection(createTranscript(), 0), [token("정상", 0, 100)]);
    const merged: Transcript = { ...transcript, finals: [...valid.finals, ...transcript.finals] };

    expect(toAnswerTokens(merged)).toBeNull();
    // content는 그대로 전송한다(tokens만 생략).
    expect(getContent(merged).startsWith("정상")).toBe(true);
  });
});

describe("speechEndMs (말소리 신호 기준)", () => {
  it("미확정 토큰을 포함해 비공백 토큰 end_ms 최댓값을 계산한다", () => {
    expect(connected(0, [token("안녕", 0, 400, false)]).speechEndMs).toBe(400);
    expect(connected(0, [token("안녕", 0, 400), token("하", 400, 500, false)]).speechEndMs).toBe(
      500,
    );
  });

  it("공백 토큰 · 시각 없는 토큰은 늘리지 않는다", () => {
    const transcript = connected(0, [token("네", 0, 300)], [token(" ", 300, 900, false)]);

    expect(transcript.speechEndMs).toBe(300);
    expect(applyResult(transcript, [token("음", 0, undefined, false)]).speechEndMs).toBe(300);
  });

  it("같은 미확정 글이 다시 수신돼도 변하지 않고, 새 연결이면 처음부터 계산한다", () => {
    const transcript = connected(0, [token("네", 0, 300, false)], [token("네", 0, 300, false)]);

    expect(transcript.speechEndMs).toBe(300);
    expect(beginConnection(transcript, 1000).speechEndMs).toBeNull();
  });
});
