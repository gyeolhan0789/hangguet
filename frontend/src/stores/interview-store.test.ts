import { afterEach, describe, expect, it } from "vitest";

import { useInterviewStore } from "./interview-store";

// 기준: API 명세 5.8(leveledUp은 5.8 응답에만 있어 화면이 S08까지 기억한다)

const KEY = "hankkeut:interview";

afterEach(() => {
  useInterviewStore.getState().reset();
  sessionStorage.clear();
});

describe("useInterviewStore (면접 화면 상태)", () => {
  it("레벨업만 sessionStorage에 남기고, 모달 · 답한 질문은 남기지 않는다", () => {
    useInterviewStore.getState().openEnd();
    useInterviewStore.getState().setAnsweredQuestion(303);
    useInterviewStore.getState().setLeveledUp(true);

    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "null")).toMatchObject({
      state: { leveledUp: true },
    });
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "null").state).not.toHaveProperty("endOpen");
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "null").state).not.toHaveProperty(
      "answeredQuestionId",
    );
  });

  it("새로고침(다시 불러오기)해도 남긴 레벨업을 되살린다", async () => {
    useInterviewStore.setState({ leveledUp: null });
    sessionStorage.setItem(KEY, JSON.stringify({ state: { leveledUp: true }, version: 0 }));

    await useInterviewStore.persist.rehydrate();

    expect(useInterviewStore.getState().leveledUp).toBe(true);
  });

  it("레벨업을 지우면(null) 남긴 값도 지운다", () => {
    useInterviewStore.getState().setLeveledUp(true);
    useInterviewStore.getState().setLeveledUp(null);

    expect(JSON.parse(sessionStorage.getItem(KEY) ?? "null").state.leveledUp).toBeNull();
  });

  it("reset은 모두 지우고, keepLeveledUp이면 레벨업만 남긴다", () => {
    useInterviewStore.setState({ endOpen: true, answeredQuestionId: 1, leveledUp: true });
    useInterviewStore.getState().reset({ keepLeveledUp: true });
    expect(useInterviewStore.getState()).toMatchObject({
      endOpen: false,
      answeredQuestionId: null,
      leveledUp: true,
    });

    useInterviewStore.getState().reset();
    expect(useInterviewStore.getState().leveledUp).toBeNull();
  });
});
