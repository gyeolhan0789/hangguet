import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { asMember, bearer, contract, problem, providerPath } from "@/test/pact";
import type { ApplicationResponse } from "@/types/api";

import { createApplication, updateApplication } from "./actions";
import { getApplication } from "./queries";

// 기준: Swagger 4.1 지원서 작성 · 4.2 조회 · 4.4 수정 예시
const { like } = MatchersV3;
const pact = contract();

const values = {
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetter: "1. 지원 동기\n저는…",
};
const application = {
  id: 10,
  ...values,
} satisfies Omit<ApplicationResponse, "inUse" | "createdAt">;
const detail = providerPath("/applications/${applicationId}", "/applications/10");

describe("지원서", () => {
  it("4.2 지원서를 조회한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .uponReceiving("4.2 지원서 조회")
      .withRequest("GET", detail, (b) => b.headers(bearer))
      .willRespondWith(200, (b) => b.jsonBody(like(application)))
      .executeTest(asMember(async () => expect(await getApplication(10)).toEqual(application))));

  it("4.2 없는 지원서는 null(404 APPLICATION_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("4.2 없는 지원서 조회")
      .withRequest("GET", "/api/v1/applications/999999999", (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, { code: "APPLICATION_NOT_FOUND" }))
      .executeTest(asMember(async () => expect(await getApplication(999999999)).toBeNull())));

  it("4.1 지원서를 쓰면 면접관 선택으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("4.1 지원서 작성")
      .withRequest("POST", "/api/v1/applications", (b) => b.headers(bearer).jsonBody(values))
      .willRespondWith(201, (b) => b.jsonBody(like({ id: 10 })))
      .executeTest(
        asMember(() => expect(createApplication(values)).rejects.toThrow("applicationId=10")),
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
          errors: [{ field: "coverLetter", reason }],
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await createApplication(values)).toEqual({ fieldErrors: { coverLetter: reason } }),
        ),
      );
  });

  it("4.4 쓸 수 없는 자기소개서는 칸 오류(400 VALIDATION_FAILED)", () => {
    const reason =
      "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.";
    return pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .given("자기소개서를 쓸 수 없다고 판단한다")
      .uponReceiving("4.4 쓸 수 없는 자기소개서로 지원서 수정")
      .withRequest("PATCH", detail, (b) => b.headers(bearer).jsonBody(values))
      .willRespondWith(400, (b) =>
        problem(b, {
          code: "VALIDATION_FAILED",
          errors: [{ field: "coverLetter", reason }],
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await updateApplication(10, values)).toEqual({
            fieldErrors: { coverLetter: reason },
          }),
        ),
      );
  });

  it("4.4 지원서를 고치면 면접관 선택으로 돌아간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("지원서")
      .uponReceiving("4.4 지원서 수정")
      .withRequest("PATCH", detail, (b) => b.headers(bearer).jsonBody(values))
      .willRespondWith(200)
      .executeTest(
        asMember(() => expect(updateApplication(10, values)).rejects.toThrow("applicationId=10")),
      ));
});
