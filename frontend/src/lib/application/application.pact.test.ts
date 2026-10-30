import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { asMember, bearer, contract, oneOf, problem, providerPath, shape } from "@/test/pact";
import type {
  ApplicationListItem,
  ApplicationResponse,
  CoverLetterItem,
  SessionListItem,
} from "@/types/api";

import { createApplication, deleteApplication } from "./actions";
import { getApplication, getApplications, getApplicationSessions } from "./queries";

// 기준: Swagger 4.1 지원서 작성 · 4.2 조회 · 4.3 목록 · 4.5 삭제 · 4.6 지원서의 연습 면접 목록 예시
const { like, eachLike } = MatchersV3;
const pact = contract();

const item = {
  itemOrder: 1,
  question: "지원 동기",
  answer:
    "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어 ○○전자 백엔드 직무에 지원했습니다.",
} satisfies CoverLetterItem;
const values = {
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [{ question: item.question, answer: item.answer }],
};
const application = {
  id: 12,
  companyName: values.companyName,
  jobTitle: values.jobTitle,
  coverLetterItems: [item],
  createdAt: "2026-10-15T11:55:00+09:00",
} satisfies ApplicationResponse;
const detail = providerPath("/applications/${applicationId}", "/applications/12");
const page = { page: "0", size: "10" };

describe("지원서", () => {
  it("4.2 지원서를 조회한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .uponReceiving("4.2 지원서 조회")
      .withRequest("GET", detail, (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({ ...shape(application), coverLetterItems: eachLike(item) }),
      )
      .executeTest(asMember(async () => expect(await getApplication(12)).toEqual(application))));

  it("4.2 없는 지원서는 null(404 APPLICATION_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("4.2 없는 지원서 조회")
      .withRequest("GET", "/api/v1/applications/999999999", (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, { code: "APPLICATION_NOT_FOUND" }))
      .executeTest(asMember(async () => expect(await getApplication(999999999)).toBeNull())));

  it("4.3 지원서 목록을 받는다", () => {
    const row = {
      id: 12,
      companyName: values.companyName,
      jobTitle: values.jobTitle,
      createdAt: application.createdAt,
    } satisfies ApplicationListItem;
    return pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .uponReceiving("4.3 지원서 목록")
      .withRequest("GET", "/api/v1/applications", (b) => b.headers(bearer).query(page))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          content: eachLike(shape(row)),
          page: shape({ totalPages: 1 }, "totalPages"),
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await getApplications(0, 10)).toEqual({ content: [row], page: { totalPages: 1 } }),
        ),
      );
  });

  it("4.1 지원서를 쓰면 지원서 상세로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("4.1 지원서 작성")
      .withRequest("POST", "/api/v1/applications", (b) => b.headers(bearer).jsonBody(values))
      .willRespondWith(201, (b) => b.jsonBody({ id: like(13) }))
      .executeTest(
        asMember(() =>
          expect(createApplication(values, "applications")).rejects.toThrow(
            "REDIRECT /applications/13",
          ),
        ),
      ));

  it("4.1 쓸 수 없는 자기소개서는 칸 오류(400 VALIDATION_FAILED)", () => {
    const reason =
      "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.";
    return pact
      .addInteraction()
      .given("회원")
      .given("자기소개서를 쓸 수 없다고 판단한다")
      .uponReceiving("4.1 쓸 수 없는 자기소개서로 지원서 작성")
      .withRequest("POST", "/api/v1/applications", (b) => b.headers(bearer).jsonBody(values))
      .willRespondWith(400, (b) =>
        problem(b, {
          code: "VALIDATION_FAILED",
          errors: [{ field: "coverLetterItems", reason }],
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await createApplication(values, "applications")).toEqual({
            fieldErrors: { coverLetterItems: reason },
          }),
        ),
      );
  });

  // 칸 오류(400)는 기본 분기를 지나지 않아, 서버 문구만 보여 주는 오류 하나를 둔다
  it("4.1 자기소개서를 판단하지 못하면 서버 문구를 보여 준다(503)", () => {
    const detail = "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
    return pact
      .addInteraction()
      .given("회원")
      .given("자기소개서를 판단하지 못한다")
      .uponReceiving("4.1 자기소개서를 판단하지 못한 지원서 작성")
      .withRequest("POST", "/api/v1/applications", (b) => b.headers(bearer).jsonBody(values))
      .willRespondWith(503, (b) =>
        problem(b, { code: "COVER_LETTER_CHECK_UNAVAILABLE", detail }, { generic: true }),
      )
      .executeTest(
        asMember(async () =>
          expect(await createApplication(values, "applications")).toEqual({ formError: detail }),
        ),
      );
  });

  it("4.5 지원서를 지우면 지원 관리 목록으로 간다(204)", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .uponReceiving("4.5 지원서 삭제")
      .withRequest("DELETE", detail, (b) => b.headers(bearer))
      .willRespondWith(204)
      .executeTest(
        asMember(() => expect(deleteApplication(12)).rejects.toThrow("REDIRECT /applications")),
      ));

  it("4.5 이미 없는 지원서도 지원 관리 목록으로 간다(404 APPLICATION_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("4.5 없는 지원서 삭제")
      .withRequest("DELETE", "/api/v1/applications/999999999", (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, { code: "APPLICATION_NOT_FOUND" }))
      .executeTest(
        asMember(() =>
          expect(deleteApplication(999999999)).rejects.toThrow("REDIRECT /applications"),
        ),
      ));

  it("4.6 지원서로 본 연습 면접 목록을 받는다", () => {
    // 지원서 상세의 면접 기록 한 줄이 읽는 필드만 둔다(분석 중이면 요약 대신 상태를 보여 준다)
    const session = {
      id: 54,
      persona: "COFFEE_CHAT",
      mode: "CHAT",
      status: "ANALYZING",
      startedAt: "2026-10-21T19:30:00+09:00",
      summary: null,
    } satisfies Pick<
      SessionListItem,
      "id" | "persona" | "mode" | "status" | "startedAt" | "summary"
    >;
    const pageInfo = { number: 0, totalElements: 2, totalPages: 1 };
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "ANALYZING", mode: "CHAT" })
      .uponReceiving("4.6 지원서의 연습 면접 목록")
      .withRequest(
        "GET",
        providerPath(
          "/applications/${applicationId}/interview-sessions",
          "/applications/12/interview-sessions",
        ),
        (b) => b.headers(bearer).query(page),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          content: eachLike({
            ...shape(session, "status", "summary"),
            persona: oneOf(["DEVIL", "COFFEE_CHAT"], session.persona),
            mode: oneOf(["CHAT", "VIDEO"], session.mode),
          }),
          page: shape(pageInfo, "number", "totalPages"),
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await getApplicationSessions(12, 0, 10)).toEqual({
            content: [session],
            page: pageInfo,
          }),
        ),
      );
  });

  it("4.6 없는 지원서는 null(404 APPLICATION_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("4.6 없는 지원서의 연습 면접 목록")
      .withRequest("GET", "/api/v1/applications/999999999/interview-sessions", (b) =>
        b.headers(bearer).query(page),
      )
      .willRespondWith(404, (b) => problem(b, { code: "APPLICATION_NOT_FOUND" }))
      .executeTest(
        asMember(async () => expect(await getApplicationSessions(999999999, 0, 10)).toBeNull()),
      ));
});
