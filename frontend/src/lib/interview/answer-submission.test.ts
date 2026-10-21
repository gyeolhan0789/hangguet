import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnswerAudioContentType } from "@/types/api";

import type {
  AnswerActionResult,
  AnswerAudioUploadUrlActionResult,
  VideoAnswerBody,
} from "./actions";
import { prepareAnswer, submitPreparedAnswer } from "./answer-submission";

// 기준: API 명세 5.6(브라우저가 S3에 직접 PUT, expiresAt 이후 주소 만료) · 5.7(Idempotency-Key, FILE_NOT_FOUND · ANSWER_ALREADY_SUBMITTED)

const submitVideoAnswer =
  vi.fn<
    (
      sessionId: number,
      questionId: number,
      body: VideoAnswerBody,
      key: string,
    ) => Promise<AnswerActionResult>
  >();
const createAnswerAudioUploadUrl =
  vi.fn<
    (
      sessionId: number,
      questionId: number,
      contentType: AnswerAudioContentType,
    ) => Promise<AnswerAudioUploadUrlActionResult>
  >();
vi.mock("./actions", () => ({
  submitVideoAnswer: (...args: Parameters<typeof submitVideoAnswer>) => submitVideoAnswer(...args),
  createAnswerAudioUploadUrl: (...args: Parameters<typeof createAnswerAudioUploadUrl>) =>
    createAnswerAudioUploadUrl(...args),
}));

/** 테스트 기준 시각. 처음 발급한 주소는 10분 뒤(12:16)에 만료된다 */
const NOW = "2026-10-15T12:06:00+09:00";

const fetchMock = vi.fn<typeof fetch>();
const calls: string[] = [];

const accepted = (isLastQuestion: boolean): AnswerActionResult => ({
  ok: true,
  id: 903,
  questionId: 303,
  inputType: "VOICE",
  createdAt: "2026-10-15T12:08:40+09:00",
  isLastQuestion,
});

function prepared() {
  return prepareAnswer({
    sessionId: 55,
    questionId: 303,
    content: "조회 응답 시간을 40% 줄였습니다.",
    tokens: [{ text: "조회", startMs: 0, endMs: 280 }],
    audio: new Blob(["webm"]),
    upload: {
      uploadUrl: "https://s3.example/put",
      objectKey: "sessions/55/answers/303.webm",
      expiresAt: "2026-10-15T12:16:00+09:00",
      contentType: "audio/webm",
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  calls.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    calls.push("PUT");
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  submitVideoAnswer.mockReset();
  submitVideoAnswer.mockImplementation(async () => {
    calls.push("5.7");
    return accepted(false);
  });
  createAnswerAudioUploadUrl.mockReset();
  createAnswerAudioUploadUrl.mockImplementation(async () => {
    calls.push("5.6");
    return {
      ok: true,
      uploadUrl: "https://s3.example/put-2",
      objectKey: "sessions/55/answers/303.webm",
      expiresAt: "2026-10-15T12:36:00+09:00",
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("prepareAnswer (제출 데이터 고정)", () => {
  it("키를 새로 생성하고 5.7 본문(content · objectKey · tokens)을 고정한다", () => {
    const first = prepared();

    expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.body).toEqual({
      content: "조회 응답 시간을 40% 줄였습니다.",
      audioObjectKey: "sessions/55/answers/303.webm",
      tokens: [{ text: "조회", startMs: 0, endMs: 280 }],
    });
    expect(first.uploaded).toBe(false);
    expect(prepared().idempotencyKey).not.toBe(first.idempotencyKey);
  });
});

describe("submitPreparedAnswer (PUT → 5.7)", () => {
  it("답변 음성을 같은 Content-Type으로 PUT한 뒤 5.7을 제출하고 isLastQuestion을 반환한다", async () => {
    const answer = prepared();
    submitVideoAnswer.mockImplementation(async () => {
      calls.push("5.7");
      return accepted(true);
    });

    expect(await submitPreparedAnswer(answer)).toEqual({ kind: "accepted", isLastQuestion: true });
    expect(calls).toEqual(["PUT", "5.7"]);
    expect(fetchMock).toHaveBeenCalledWith("https://s3.example/put", {
      method: "PUT",
      headers: { "Content-Type": "audio/webm" },
      body: answer.audio,
    });
    expect(submitVideoAnswer).toHaveBeenCalledWith(55, 303, answer.body, answer.idempotencyKey);
    expect(createAnswerAudioUploadUrl).not.toHaveBeenCalled();
  });

  it("PUT이 실패하면 5.7을 제출하지 않고, 다음 시도는 주소를 다시 발급받아 PUT부터 수행한다", async () => {
    const answer = prepared();
    fetchMock.mockImplementationOnce(async () => {
      calls.push("PUT");
      return new Response(null, { status: 403 });
    });

    const first = await submitPreparedAnswer(answer);
    if (first.kind !== "failed") throw new Error("expected failure");
    expect(first).toMatchObject({ failure: null, next: { uploaded: false } });
    expect(submitVideoAnswer).not.toHaveBeenCalled();
    calls.length = 0;
    const second = await submitPreparedAnswer(first.next);

    expect(second).toEqual({ kind: "accepted", isLastQuestion: false });
    expect(calls).toEqual(["5.6", "PUT", "5.7"]);
    expect(createAnswerAudioUploadUrl).toHaveBeenCalledWith(55, 303, "audio/webm");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://s3.example/put-2");
    expect(submitVideoAnswer).toHaveBeenCalledWith(55, 303, answer.body, answer.idempotencyKey);
  });

  it("주소가 만료되었으면 PUT 전에 다시 발급받고, 키 · 본문은 그대로 5.7을 제출한다", async () => {
    const answer = prepared();
    vi.setSystemTime(new Date("2026-10-15T12:16:00+09:00"));

    expect(await submitPreparedAnswer(answer)).toEqual({ kind: "accepted", isLastQuestion: false });
    expect(calls).toEqual(["5.6", "PUT", "5.7"]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://s3.example/put-2");
    expect(submitVideoAnswer).toHaveBeenCalledWith(55, 303, answer.body, answer.idempotencyKey);
  });

  it("주소 재발급이 실패하면 PUT · 5.7 없이 5.6의 code · status를 반환한다", async () => {
    const answer = prepared();
    vi.setSystemTime(new Date("2026-10-15T12:20:00+09:00"));
    createAnswerAudioUploadUrl.mockResolvedValueOnce({
      ok: false,
      code: "INVALID_SESSION_STATE",
      status: 409,
    });

    expect(await submitPreparedAnswer(answer)).toMatchObject({
      kind: "failed",
      failure: { ok: false, code: "INVALID_SESSION_STATE", status: 409 },
      next: { uploaded: false },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submitVideoAnswer).not.toHaveBeenCalled();
  });

  it("PUT 연결 자체가 실패해도 실패로 반환한다", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(await submitPreparedAnswer(prepared())).toMatchObject({ kind: "failed", failure: null });
  });

  it("5.7이 실패하면 다음 시도는 PUT 없이 5.7부터 같은 키 · 같은 본문으로 전송한다", async () => {
    const answer = prepared();
    submitVideoAnswer.mockResolvedValueOnce({ ok: false, code: null, status: 502 });

    const first = await submitPreparedAnswer(answer);
    if (first.kind !== "failed") throw new Error("expected failure");
    expect(first.failure).toEqual({ ok: false, code: null, status: 502 });
    calls.length = 0;
    const second = await submitPreparedAnswer(first.next);

    expect(second).toEqual({ kind: "accepted", isLastQuestion: false });
    expect(calls).toEqual(["5.7"]);
    expect(submitVideoAnswer.mock.calls[1]).toEqual(submitVideoAnswer.mock.calls[0]);
  });

  it("FILE_NOT_FOUND면 다음 시도는 PUT부터 다시 수행하고 키 · 본문은 그대로다", async () => {
    const answer = prepared();
    submitVideoAnswer.mockResolvedValueOnce({ ok: false, code: "FILE_NOT_FOUND", status: 404 });

    const first = await submitPreparedAnswer(answer);
    if (first.kind !== "failed") throw new Error("expected failure");
    calls.length = 0;
    await submitPreparedAnswer(first.next);

    expect(calls).toEqual(["PUT", "5.7"]);
    expect(submitVideoAnswer.mock.calls[1]).toEqual([55, 303, answer.body, answer.idempotencyKey]);
  });

  it("409 ANSWER_ALREADY_SUBMITTED면 이미 제출한 답변으로 간주한다", async () => {
    submitVideoAnswer.mockResolvedValueOnce({
      ok: false,
      code: "ANSWER_ALREADY_SUBMITTED",
      status: 409,
    });

    expect(await submitPreparedAnswer(prepared())).toEqual({ kind: "alreadySubmitted" });
  });
});
