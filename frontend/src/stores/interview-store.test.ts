import { afterEach, describe, expect, it } from "vitest";

import { useInterviewStore } from "./interview-store";

// 기준: 웹 Swagger leveledUp(5.8 응답에만 값이 있어 화면이 S08까지 기억한다)

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

  it("접기(collapsed) · 화면 숨기기(uiHidden)는 누를 때마다 바뀌고, 저장하지 않는다", () => {
    useInterviewStore.getState().toggleCollapsed();
    useInterviewStore.getState().toggleUiHidden();
    expect(useInterviewStore.getState()).toMatchObject({ collapsed: true, uiHidden: true });
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null").state;
    expect(saved).not.toHaveProperty("collapsed");
    expect(saved).not.toHaveProperty("uiHidden");
    useInterviewStore.getState().toggleCollapsed();
    useInterviewStore.getState().toggleUiHidden();
    expect(useInterviewStore.getState()).toMatchObject({ collapsed: false, uiHidden: false });
  });

  it("제출된 답변 순서(submittedSeq) · 저장 확인 중(confirmingSave)은 저장하지 않는다", () => {
    useInterviewStore.getState().setSubmittedSeq(3);
    useInterviewStore.getState().setConfirmingSave(true);
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null").state;
    expect(saved).not.toHaveProperty("submittedSeq");
    expect(saved).not.toHaveProperty("confirmingSave");
  });

  it("reset은 모두 지우고, keepLeveledUp이면 레벨업만 남긴다", () => {
    useInterviewStore.setState({
      endOpen: true,
      answeredQuestionId: 1,
      submittedSeq: 3,
      confirmingSave: true,
      leveledUp: true,
      collapsed: true,
      uiHidden: true,
    });
    useInterviewStore.getState().reset({ keepLeveledUp: true });
    expect(useInterviewStore.getState()).toMatchObject({
      endOpen: false,
      answeredQuestionId: null,
      submittedSeq: null,
      confirmingSave: false,
      leveledUp: true,
      collapsed: false,
      uiHidden: false,
    });

    useInterviewStore.getState().reset();
    expect(useInterviewStore.getState().leveledUp).toBeNull();
  });
});
