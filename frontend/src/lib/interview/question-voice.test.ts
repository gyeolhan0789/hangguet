import { describe, expect, it } from "vitest";

import type { QuestionTtsStatus } from "@/components/interview/use-question-tts";
import type { VideoAnswerPhase } from "@/components/interview/video-answer-contract";

import { questionVoiceGate } from "./question-voice";

// 기준: API 명세 5.12(실패해도 글로 진행) · 화상 답변 상태별 [다시 듣기] · 재생 중 [답변 시작] 잠금(FE 임시 결정)

describe("questionVoiceGate 화상 [답변 시작] 잠금", () => {
  it.each<[QuestionTtsStatus, boolean]>([
    ["loading", true],
    ["playing", true],
    ["ended", false],
    ["failed", false],
    ["idle", false],
  ])("질문 음성 %s: 잠금 %s", (status, locked) => {
    expect(questionVoiceGate(status, null, "idle").answerStartLocked).toBe(locked);
  });

  it("질문 음성이 실패해도 답변 시작을 잠그지 않는다(글로 진행)", () => {
    expect(questionVoiceGate("failed", "token", "idle").answerStartLocked).toBe(false);
  });

  it("채팅은 답변 시작 잠금이 없다", () => {
    expect(questionVoiceGate("playing", null, null).answerStartLocked).toBe(false);
  });
});

describe("questionVoiceGate [다시 듣기]", () => {
  it.each<[VideoAnswerPhase, boolean]>([
    ["idle", true],
    ["timedOut", true],
    ["starting", false],
    ["listening", false],
    ["submitting", false],
    ["submitFailed", false],
    ["submitted", false],
  ])("화상 답변 %s: 열림 %s", (phase, open) => {
    expect(questionVoiceGate("ended", null, phase).replayOpen).toBe(open);
  });

  it("채팅은 언제든 활성화한다", () => {
    expect(questionVoiceGate("playing", null, null).replayOpen).toBe(true);
  });
});

describe("questionVoiceGate [질문 듣기]", () => {
  it("녹음 · 제출 중에는 자동재생이 차단돼도 [질문 듣기]를 보여 주지 않는다", () => {
    expect(questionVoiceGate("failed", "blocked", "listening").needsListenButton).toBe(false);
    expect(questionVoiceGate("failed", "blocked", "submitting").needsListenButton).toBe(false);
    expect(questionVoiceGate("failed", "blocked", null).needsListenButton).toBe(true);
  });

  it("자동재생 정책으로 차단됐을 때만 표시한다", () => {
    expect(questionVoiceGate("failed", "blocked", "idle").needsListenButton).toBe(true);
    expect(questionVoiceGate("failed", "token", "idle").needsListenButton).toBe(false);
    expect(questionVoiceGate("playing", null, "idle").needsListenButton).toBe(false);
  });
});
