import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import {
  asMember,
  bearer,
  contract,
  problem,
  providerPath,
  providerValue,
  sessionPath,
  shape,
} from "@/test/pact";
import type { AnswerResponse, RoomResponse, SessionResponse } from "@/types/api";

import {
  createSession,
  endSession,
  issueRoomToken,
  retryPlan,
  startSession,
  submitTextAnswer,
} from "./actions";
import { getCurrentQuestion, getSession } from "./queries";

// 기준: Swagger 5.1~5.8 · 5.14 면접 진행 예시
const { like } = MatchersV3;
const pact = contract();

const KEY = "3f2b8c1e-7d4a-4f6b-9a2e-1c5d8e7f9a01";
const idempotent = { ...bearer, "Idempotency-Key": KEY };
const notFound = { code: "SESSION_NOT_FOUND" };
const invalidState = { detail: "지금은 할 수 없는 요청이에요.", code: "INVALID_SESSION_STATE" };

// 5.2를 받는 화면(기기 확인 · 면접)이 읽는 필드만 둔다
type SessionView = Omit<
  SessionResponse,
  "currentQuestion" | "startedAt" | "endedAt" | "createdAt" | "leveledUp" | "room"
>;
const ready = {
  id: 55,
  applicationId: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "READY",
  planStatus: "GENERATING",
  planProgress: 0,
  analysisStep: null,
  answeredCount: 0,
  elapsedSeconds: 0,
} satisfies SessionView;
const inProgress = {
  ...ready,
  mode: "CHAT",
  status: "IN_PROGRESS",
  planStatus: "READY",
  planProgress: null,
} satisfies SessionView;
const analyzing = {
  ...inProgress,
  status: "ANALYZING",
  analysisStep: "ORGANIZING_ANSWERS",
  answeredCount: 1,
} satisfies SessionView;

describe("면접 만들기 · 조회", () => {
  it("5.1 면접을 만들면 기기 확인으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .uponReceiving("5.1 면접 만들기")
      .withRequest("POST", "/api/v1/interview-sessions", (b) =>
        b.headers(idempotent).jsonBody({
          applicationId: providerValue("applicationId", 10),
          persona: "DEVIL",
          mode: "VIDEO",
        }),
      )
      .willRespondWith(201, (b) => b.jsonBody(like({ id: 55 })))
      .executeTest(
        asMember(() =>
          expect(
            createSession({ applicationId: 10, persona: "DEVIL", mode: "VIDEO" }, KEY),
          ).rejects.toThrow("sessionId=55"),
        ),
      ));

  it("5.1 없는 지원서면 연습 시작으로 돌아간다(404 APPLICATION_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("5.1 없는 지원서로 면접 만들기")
      .withRequest("POST", "/api/v1/interview-sessions", (b) =>
        b
          .headers(idempotent)
          .jsonBody({ applicationId: 999999999, persona: "DEVIL", mode: "VIDEO" }),
      )
      .willRespondWith(404, (b) =>
        problem(b, {
          code: "APPLICATION_NOT_FOUND",
        }),
      )
      .executeTest(
        asMember(() =>
          expect(
            createSession({ applicationId: 999999999, persona: "DEVIL", mode: "VIDEO" }, KEY),
          ).rejects.toThrow("REDIRECT /practice"),
        ),
      ));

  it("5.1 그 밖의 오류면 멱등 키를 새로 만들게 한다(409 IDEMPOTENCY_KEY_REUSED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .given("다른 요청에 쓴 멱등 키", { key: KEY })
      .uponReceiving("5.1 다른 요청에 쓴 멱등 키로 면접 만들기")
      .withRequest("POST", "/api/v1/interview-sessions", (b) =>
        b.headers(idempotent).jsonBody({
          applicationId: providerValue("applicationId", 10),
          persona: "DEVIL",
          mode: "VIDEO",
        }),
      )
      .willRespondWith(409, (b) =>
        problem(
          b,
          { detail: "이미 처리된 요청이에요.", code: "IDEMPOTENCY_KEY_REUSED" },
          { generic: true },
        ),
      )
      .executeTest(
        asMember(async () =>
          expect(
            await createSession({ applicationId: 10, persona: "DEVIL", mode: "VIDEO" }, KEY),
          ).toMatchObject({ keySpent: true }),
        ),
      ));

  it.each([
    {
      stage: "GENERATING",
      example: ready,
      exact: ["persona", "mode", "status", "planStatus", "answeredCount"] as const,
    },
    {
      stage: "IN_PROGRESS",
      example: inProgress,
      exact: ["persona", "mode", "status", "planStatus", "answeredCount"] as const,
    },
    {
      stage: "ANALYZING",
      example: analyzing,
      exact: ["persona", "mode", "status", "analysisStep", "answeredCount"] as const,
    },
  ])("5.2 $stage 면접을 조회한다", ({ stage, example, exact }) =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage, mode: example.mode })
      .uponReceiving(`5.2 ${stage} 면접 조회`)
      .withRequest("GET", sessionPath(""), (b) => b.headers(bearer))
      .willRespondWith(200, (b) => b.jsonBody(shape(example, ...exact)))
      .executeTest(asMember(async () => expect(await getSession(55)).toEqual(example))),
  );

  it("5.2 없는 면접은 null(404 SESSION_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("5.2 없는 면접 조회")
      .withRequest("GET", "/api/v1/interview-sessions/999999999", (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, notFound))
      .executeTest(asMember(async () => expect(await getSession(999999999)).toBeNull())));
});

describe("면접 준비 · 시작", () => {
  it("5.3 실패한 질문 준비를 다시 시작한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "PLAN_FAILED", mode: "VIDEO" })
      .uponReceiving("5.3 면접 플랜 재생성")
      .withRequest("POST", sessionPath("/plan/retry"), (b) => b.headers(bearer))
      .willRespondWith(202)
      .executeTest(asMember(async () => expect(await retryPlan(55)).toEqual({}))));

  it("5.4 면접을 시작하면 면접 화면으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "PLAN_READY", mode: "VIDEO" })
      .uponReceiving("5.4 면접 시작")
      .withRequest("POST", sessionPath("/start"), (b) => b.headers(idempotent))
      .willRespondWith(200)
      .executeTest(asMember(() => expect(startSession(55, KEY)).rejects.toThrow(/^REDIRECT /))));

  it("5.4 질문을 준비 중이면 다시 그린다(409 PLAN_NOT_READY)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "GENERATING", mode: "VIDEO" })
      .uponReceiving("5.4 질문 준비 중에 면접 시작")
      .withRequest("POST", sessionPath("/start"), (b) => b.headers(idempotent))
      .willRespondWith(409, (b) =>
        problem(b, {
          detail: "면접관이 질문을 준비하고 있어요.",
          code: "PLAN_NOT_READY",
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await startSession(55, KEY)).toMatchObject({
            formError: "면접관이 질문을 준비하고 있어요.",
          }),
        ),
      ));

  it("5.14 면접방 입장 토큰을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "IN_PROGRESS", mode: "VIDEO" })
      .uponReceiving("5.14 면접방 입장 토큰")
      .withRequest("POST", sessionPath("/room-token"), (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            url: "wss://rtc.hangguet.co.kr",
            token: "eyJhbGciOiJIUzI1NiJ9…",
          } satisfies Pick<RoomResponse, "url" | "token">),
        ),
      )
      .executeTest(
        asMember(async () => expect(await issueRoomToken(55)).toMatchObject({ ok: true })),
      ));
});

describe("질문 · 답변 · 끝내기", () => {
  const question = providerPath(
    "/interview-sessions/${sessionId}/questions/${questionId}/answer",
    "/interview-sessions/55/questions/303/answer",
  );
  const answer = { inputType: "TEXT", content: "캐시 무효화 시점을 직접 설계했습니다." } as const;

  it("5.5 지금 질문을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "IN_PROGRESS", mode: "CHAT" })
      .uponReceiving("5.5 지금 질문")
      .withRequest("GET", sessionPath("/questions/current"), (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody(
          shape({ id: 303, seq: 1, content: "가장 큰 기술적 문제는 무엇이었나요?" }, "seq"),
        ),
      )
      .executeTest(
        asMember(async () => expect(await getCurrentQuestion(55)).toMatchObject({ seq: 1 })),
      ));

  it("5.5 다음 질문을 만드는 중이면 null(202)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "ANSWERED", mode: "CHAT" })
      .uponReceiving("5.5 다음 질문을 만드는 중")
      .withRequest("GET", sessionPath("/questions/current"), (b) => b.headers(bearer))
      .willRespondWith(202)
      .executeTest(asMember(async () => expect(await getCurrentQuestion(55)).toBeNull())));

  it("5.5 면접 중이 아니면 null(409 INVALID_SESSION_STATE)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "GENERATING", mode: "CHAT" })
      .uponReceiving("5.5 면접 시작 전 지금 질문")
      .withRequest("GET", sessionPath("/questions/current"), (b) => b.headers(bearer))
      .willRespondWith(409, (b) => problem(b, { code: "INVALID_SESSION_STATE" }))
      .executeTest(asMember(async () => expect(await getCurrentQuestion(55)).toBeNull())));

  it("5.7 채팅 답변을 낸다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "IN_PROGRESS", mode: "CHAT" })
      .uponReceiving("5.7 답변 제출")
      .withRequest("POST", question, (b) => b.headers(idempotent).jsonBody(answer))
      .willRespondWith(202, (b) =>
        b.jsonBody({ isLastQuestion: false } satisfies Partial<AnswerResponse>),
      )
      .executeTest(
        asMember(async () =>
          expect(await submitTextAnswer(55, 303, { content: answer.content }, KEY)).toEqual({
            isLastQuestion: false,
          }),
        ),
      ));

  it("5.7 이미 답한 질문이면 알린다(409 ANSWER_ALREADY_SUBMITTED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "ANSWERED", mode: "CHAT" })
      .uponReceiving("5.7 이미 답한 질문에 답변 제출")
      .withRequest("POST", question, (b) => b.headers(idempotent).jsonBody(answer))
      .willRespondWith(409, (b) => problem(b, { code: "ANSWER_ALREADY_SUBMITTED" }))
      .executeTest(
        asMember(async () =>
          expect(await submitTextAnswer(55, 303, { content: answer.content }, KEY)).toMatchObject({
            alreadySubmitted: true,
          }),
        ),
      ));

  it("5.7 면접이 끝났으면 다시 그린다(409 INVALID_SESSION_STATE)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "ANALYZING", mode: "CHAT" })
      .uponReceiving("5.7 끝난 면접에 답변 제출")
      .withRequest("POST", question, (b) => b.headers(idempotent).jsonBody(answer))
      .willRespondWith(409, (b) => problem(b, invalidState))
      .executeTest(
        asMember(async () =>
          expect(await submitTextAnswer(55, 303, { content: answer.content }, KEY)).toEqual({
            formError: "지금은 할 수 없는 요청이에요.",
            keySpent: true,
          }),
        ),
      ));

  it("5.8 답한 면접을 끝내면 분석으로 넘어간다(202)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "ANSWERED", mode: "CHAT" })
      .uponReceiving("5.8 답한 면접 끝내기")
      .withRequest("POST", sessionPath("/end"), (b) => b.headers(idempotent))
      .willRespondWith(202, (b) => b.jsonBody({ status: "ANALYZING", leveledUp: true }))
      .executeTest(
        asMember(async () => expect(await endSession(55, KEY)).toEqual({ leveledUp: true })),
      ));

  it("5.8 답 없이 끝내면 홈으로 간다(200 ABORTED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "IN_PROGRESS", mode: "CHAT" })
      .uponReceiving("5.8 답 없이 면접 끝내기")
      .withRequest("POST", sessionPath("/end"), (b) => b.headers(idempotent))
      .willRespondWith(200, (b) => b.jsonBody({ status: "ABORTED" }))
      .executeTest(asMember(() => expect(endSession(55, KEY)).rejects.toThrow("REDIRECT /home"))));

  it("5.8 이미 끝난 면접이면 다시 그린다(409 INVALID_SESSION_STATE)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "ANALYZING", mode: "CHAT" })
      .uponReceiving("5.8 끝난 면접 끝내기")
      .withRequest("POST", sessionPath("/end"), (b) => b.headers(idempotent))
      .willRespondWith(409, (b) => problem(b, invalidState))
      .executeTest(
        asMember(async () =>
          expect(await endSession(55, KEY)).toMatchObject({
            formError: "지금은 할 수 없는 요청이에요.",
          }),
        ),
      ));
});

describe("없거나 상태가 맞지 않는 면접", () => {
  it.each([
    { name: "5.3 면접 플랜 재생성", path: "/plan/retry", call: () => retryPlan(999999999) },
    { name: "5.4 면접 시작", path: "/start", call: () => startSession(999999999, KEY) },
    {
      name: "5.7 답변 제출",
      path: "/questions/303/answer",
      call: () => submitTextAnswer(999999999, 303, { content: "답" }, KEY),
    },
    { name: "5.8 면접 끝내기", path: "/end", call: () => endSession(999999999, KEY) },
  ])("$name: 없는 면접이면 연습 시작으로 돌아간다(404 SESSION_NOT_FOUND)", ({ name, path, call }) =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving(`${name} 없는 면접`)
      .withRequest("POST", `/api/v1/interview-sessions/999999999${path}`, (b) => {
        b.headers(path === "/plan/retry" ? bearer : idempotent);
        if (path.endsWith("/answer")) b.jsonBody({ inputType: "TEXT", content: "답" });
      })
      .willRespondWith(404, (b) => problem(b, notFound))
      .executeTest(asMember(() => expect(call()).rejects.toThrow("REDIRECT /practice"))),
  );

  it("5.3 실패하지 않은 질문 준비면 다시 그린다(409 PLAN_NOT_FAILED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "GENERATING", mode: "VIDEO" })
      .uponReceiving("5.3 실패하지 않은 면접 플랜 재생성")
      .withRequest("POST", sessionPath("/plan/retry"), (b) => b.headers(bearer))
      .willRespondWith(409, (b) =>
        problem(b, { detail: "면접 준비가 실패한 상태가 아니에요.", code: "PLAN_NOT_FAILED" }),
      )
      .executeTest(
        asMember(async () =>
          expect(await retryPlan(55)).toEqual({ formError: "면접 준비가 실패한 상태가 아니에요." }),
        ),
      ));

  it("5.14 없는 면접이면 실패를 돌려준다(404)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("5.14 없는 면접 입장 토큰")
      .withRequest("POST", "/api/v1/interview-sessions/999999999/room-token", (b) =>
        b.headers(bearer),
      )
      .willRespondWith(404)
      .executeTest(
        asMember(async () => expect(await issueRoomToken(999999999)).toMatchObject({ ok: false })),
      ));
});
