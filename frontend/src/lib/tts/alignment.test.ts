import { describe, expect, it } from "vitest";

import { buildTimeline, splitDurationByBytes, type TtsAlignment } from "./alignment";

// 기준: ElevenLabs stream-input 공식 API 문서(alignment 시각은 그 응답 조각 기준) · API 명세 5.12(글자별 발음 시각)

function alignment(chars: string[], starts: number[], durations: number[]): TtsAlignment {
  return { chars, charStartTimesMs: starts, charDurationsMs: durations };
}

describe("buildTimeline", () => {
  it("조각 시각에 앞 조각들의 길이를 더해 질문 전체 기준으로 이어 붙인다", () => {
    expect(
      buildTimeline([
        { durationMs: 500, alignment: alignment(["안", "녕"], [0, 200], [200, 250]) },
        { durationMs: 400, alignment: alignment(["하", "세"], [10, 150], [140, 200]) },
        { durationMs: 300, alignment: alignment(["요"], [0], [280]) },
      ]),
    ).toEqual([
      { char: "안", startMs: 0, endMs: 200 },
      { char: "녕", startMs: 200, endMs: 450 },
      { char: "하", startMs: 510, endMs: 650 },
      { char: "세", startMs: 650, endMs: 850 },
      { char: "요", startMs: 900, endMs: 1180 },
    ]);
  });

  it("alignment가 없는 조각은 글자를 추가하지 않고 길이만 더한다", () => {
    expect(
      buildTimeline([
        { durationMs: 500, alignment: null },
        { durationMs: 300, alignment: alignment(["네"], [20], [100]) },
      ]),
    ).toEqual([{ char: "네", startMs: 520, endMs: 620 }]);
  });

  it("세 배열 길이가 다른 조각은 건너뛴다", () => {
    expect(
      buildTimeline([
        { durationMs: 500, alignment: alignment(["가", "나"], [0], [100, 100]) },
        { durationMs: 300, alignment: alignment(["다"], [0, 50], [100]) },
        { durationMs: 200, alignment: alignment(["라"], [0], [150]) },
      ]),
    ).toEqual([{ char: "라", startMs: 800, endMs: 950 }]);
  });

  it("공백 · 문장부호 글자도 수신한 그대로 추가한다", () => {
    expect(
      buildTimeline([
        {
          durationMs: 600,
          alignment: alignment(
            ["네", ",", " ", "A", "?"],
            [0, 100, 150, 200, 400],
            [100, 50, 50, 200, 100],
          ),
        },
      ]).map(({ char }) => char),
    ).toEqual(["네", ",", " ", "A", "?"]);
  });

  it("조각이 없으면 빈 timeline", () => {
    expect(buildTimeline([])).toEqual([]);
  });
});

describe("splitDurationByBytes", () => {
  it("전체 길이를 디코드 전 조각 바이트 수에 비례해 나눈다(PCM · 고정 비트레이트 MP3)", () => {
    // pcm 16비트 모노 16kHz라면 1초 = 32,000바이트: 16,000바이트 · 48,000바이트는 0.5초 · 1.5초다.
    expect(splitDurationByBytes([16_000, 48_000], 2_000)).toEqual([500, 1_500]);
  });

  it("바이트가 모두 0이면 길이도 0", () => {
    expect(splitDurationByBytes([0, 0], 1_000)).toEqual([0, 0]);
  });
});
