import { describe, expect, it } from "vitest";

import {
  AUTO_SUBMIT_SILENCE_MS,
  initialAutoSubmitState,
  nextAutoSubmit,
  NO_SPEECH_TIMEOUT_MS,
  type AutoSubmitEvent,
  type AutoSubmitState,
} from "./auto-submit";

// 시각은 답변 시작을 0으로 한 밀리초다. 타이머 대신 tick(now)으로 시간을 전달한다.

/** 이벤트를 차례로 반영하고 마지막 상태와 tick마다의 결정을 반환한다 */
function run(events: AutoSubmitEvent[], from: AutoSubmitState = initialAutoSubmitState) {
  let state = from;
  const decisions: string[] = [];
  for (const event of events) {
    const step = nextAutoSubmit(state, event);
    state = step.state;
    if (event.type === "tick") decisions.push(step.decision);
  }
  return { state, decisions };
}

const start: AutoSubmitEvent = { type: "answerStarted", at: 0 };
const speech = (at: number): AutoSubmitEvent => ({ type: "speech", at });
const tick = (now: number): AutoSubmitEvent => ({ type: "tick", now });

describe("상수 (API 명세 5.7, 임시 값)", () => {
  it("7초 · 60초", () => {
    expect(AUTO_SUBMIT_SILENCE_MS).toBe(7_000);
    expect(NO_SPEECH_TIMEOUT_MS).toBe(60_000);
  });
});

describe("7초 자동 제출", () => {
  it("말하기 전에는 7초가 지나도 제출하지 않는다", () => {
    expect(run([start, tick(7_000), tick(30_000)]).decisions).toEqual(["wait", "wait"]);
  });

  it("마지막 말소리 뒤 6.999초면 제출하지 않고 7초면 제출한다", () => {
    const { state, decisions } = run([start, speech(1_000), tick(7_999), tick(8_000)]);
    expect(decisions).toEqual(["wait", "submit"]);
    expect(state.phase).toBe("submitting");
  });

  it("7초 안에 다시 말하면 그때부터 다시 계산한다", () => {
    expect(run([start, speech(1_000), speech(5_000), tick(8_000), tick(12_000)]).decisions).toEqual(
      ["wait", "submit"],
    );
  });

  it("SDK 재연결 중에는 7초가 지나도 제출하지 않고, 재연결 뒤 7초면 제출한다", () => {
    const { decisions } = run([
      start,
      speech(1_000),
      { type: "reconnecting" },
      tick(8_000),
      tick(20_000),
      { type: "reconnected", at: 20_000 },
      tick(26_999),
      tick(27_000),
    ]);
    expect(decisions).toEqual(["wait", "wait", "wait", "submit"]);
  });

  it("말하기 전에 재연결됐으면 재연결 뒤에도 7초를 설정하지 않는다", () => {
    const { decisions } = run([
      start,
      { type: "reconnecting" },
      { type: "reconnected", at: 2_000 },
      tick(9_000),
      tick(30_000),
    ]);
    expect(decisions).toEqual(["wait", "wait"]);
  });

  it("재연결 중에 감지된 말소리는 발화 시작 상태만 기록하고, 7초는 재연결 뒤부터 계산한다", () => {
    expect(run([start, { type: "reconnecting" }, speech(3_000)]).state).toEqual({
      phase: "reconnecting",
      spoke: true,
      listenStartedAt: 0,
      silenceStartedAt: null,
    });
    const { decisions } = run([
      start,
      { type: "reconnecting" },
      speech(3_000),
      tick(10_000),
      { type: "reconnected", at: 12_000 },
      tick(18_999),
      tick(19_000),
      tick(70_000),
    ]);
    expect(decisions).toEqual(["wait", "wait", "submit", "wait"]);
  });

  it("음성 인식 오류(sttError) 뒤에는 제출하지 않는다", () => {
    const { state, decisions } = run([start, speech(1_000), { type: "sttError" }, tick(8_000)]);
    expect(decisions).toEqual(["wait"]);
    expect(state.phase).toBe("error");
  });

  it("제출 중에 다시 제출 이벤트가 발생해도 한 번만 진행한다", () => {
    const submitting = run([start, speech(1_000), tick(8_000)]);
    expect(submitting.decisions).toEqual(["submit"]);
    // 자동 제출 뒤 수동 [답변 완료] · 다음 tick은 상태를 변경하지 않는다.
    const after = run([{ type: "submitStarted" }, tick(20_000)], submitting.state);
    expect(after.state).toEqual(submitting.state);
    expect(after.decisions).toEqual(["wait"]);
  });

  it("수동 제출(submitStarted) 뒤에는 7초가 지나도 자동 제출하지 않는다", () => {
    const { state, decisions } = run([
      start,
      speech(1_000),
      { type: "submitStarted" },
      tick(8_000),
    ]);
    expect(decisions).toEqual(["wait"]);
    expect(state.phase).toBe("submitting");
  });
});

describe("60초 종료", () => {
  it("말을 시작하지 않은 채 60초면 종료한다", () => {
    const { state, decisions } = run([start, tick(59_999), tick(60_000)]);
    expect(decisions).toEqual(["wait", "timeout"]);
    expect(state.phase).toBe("ended");
  });

  it("말을 시작했으면 60초가 지나도 종료하지 않는다", () => {
    const { decisions } = run([start, speech(50_000), { type: "reconnecting" }, tick(70_000)]);
    expect(decisions).toEqual(["wait"]);
  });

  it("SDK 자동 재연결은 60초를 새로 계산하지 않는다", () => {
    const { decisions } = run([
      start,
      { type: "reconnecting" },
      tick(40_000),
      { type: "reconnected", at: 45_000 },
      tick(60_000),
    ]);
    expect(decisions).toEqual(["wait", "timeout"]);
  });

  it("재연결 중에도 60초가 차면 종료한다", () => {
    expect(run([start, { type: "reconnecting" }, tick(60_000)]).decisions).toEqual(["timeout"]);
  });

  it("[다시 연결] 전에 인식된 글이 있으면 발화를 시작한 것으로 간주하고 그때부터 7초 뒤 자동 제출한다", () => {
    const { decisions } = run([
      start,
      speech(1_000),
      { type: "sttError" },
      { type: "manualReconnect", at: 30_000, hasAnswer: true },
      tick(36_999),
      tick(37_000),
    ]);
    expect(decisions).toEqual(["wait", "submit"]);
  });

  it("[다시 연결] 전에 인식된 글이 없으면 발화 시작 상태를 초기화하고 그때부터 60초를 계산한다", () => {
    const { decisions } = run([
      start,
      speech(1_000),
      { type: "sttError" },
      { type: "manualReconnect", at: 30_000, hasAnswer: false },
      tick(60_000),
      tick(89_999),
      tick(90_000),
    ]);
    expect(decisions).toEqual(["wait", "wait", "timeout"]);
  });

  it("빈 답변 다시 듣기(relisten) 뒤에는 발화 시작 상태를 초기화하고 그때부터 60초를 계산한다", () => {
    const { decisions } = run([
      start,
      speech(1_000),
      tick(8_000),
      { type: "relisten", at: 20_000 },
      tick(60_000),
      tick(79_999),
      tick(80_000),
    ]);
    expect(decisions).toEqual(["submit", "wait", "wait", "timeout"]);
  });

  it("다시 듣기 뒤 말하면 다시 7초 자동 제출을 계산한다", () => {
    const { decisions } = run([
      start,
      speech(1_000),
      tick(8_000),
      { type: "relisten", at: 20_000 },
      speech(22_000),
      tick(29_000),
    ]);
    expect(decisions).toEqual(["submit", "submit"]);
  });

  it("음성 인식 오류 상태에서는 60초 종료도 하지 않는다", () => {
    expect(run([start, { type: "sttError" }, tick(60_000)]).decisions).toEqual(["wait"]);
  });
});

describe("의미 없는 이벤트", () => {
  it("답변 전 · 60초 종료 뒤의 말소리 · 재연결 · 다시 듣기 · 제출은 상태를 변경하지 않는다", () => {
    const ignored: AutoSubmitEvent[] = [
      speech(1_000),
      { type: "reconnecting" },
      { type: "reconnected", at: 1_000 },
      { type: "relisten", at: 1_000 },
      { type: "manualReconnect", at: 1_000, hasAnswer: false },
      { type: "submitStarted" },
      { type: "sttError" },
    ];
    expect(run(ignored).state).toEqual(initialAutoSubmitState);

    const ended = run([start, tick(60_000)]).state;
    expect(run(ignored, ended).state).toEqual(ended);
  });

  it("60초 종료 뒤 [다시 시작](answerStarted)이면 새로 계산한다", () => {
    const ended = run([start, tick(60_000)]).state;
    const { state, decisions } = run(
      [{ type: "answerStarted", at: 70_000 }, tick(129_999), tick(130_000)],
      ended,
    );
    expect(decisions).toEqual(["wait", "timeout"]);
    expect(state.phase).toBe("ended");
  });
});
