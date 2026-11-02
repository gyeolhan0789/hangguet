import { MatchersV3, PactV4 } from "@pact-foundation/pact";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/auth-cookies";
import { api } from "@/lib/api/client";
import { plainClient } from "@/lib/api/token-refresh";
import type { ProblemDetail } from "@/types/api";

// Pact 계약 테스트 공용. 계약 파일은 frontend/pacts/(gitignore)에 생기고, CI에서 BE 잡이 받아 검증한다(.gitlab-ci.yml be-pact).

export function contract() {
  return new PactV4({
    consumer: "a301-frontend",
    provider: "a301-backend",
    dir: "pacts",
    logLevel: "warn",
  });
}

/** FE가 쿠키에서 읽어 보내는 토큰. BE는 상황(given)이 발급한 토큰으로 바꿔 넣는다. */
export const EXAMPLE_ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.contract-access";
export const EXAMPLE_REFRESH_TOKEN = "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10";

/** next/headers 목이 읽는 쿠키(pact-setup.ts) */
export const cookieValues: Record<string, string> = {};

/** FE 함수가 Pact 가짜 서버(포트는 무작위)로 요청하게 한다. 두 axios 인스턴스는 모듈을 불러올 때 주소가 정해진다. */
function useMockServer(url: string) {
  api.defaults.baseURL = `${url}/api/v1`;
  plainClient.defaults.baseURL = `${url}/api/v1`;
}

/** executeTest 콜백: 로그인한 상태(쿠키에 토큰)로 FE 함수를 가짜 서버에 보낸다. */
export const asMember = (call: () => Promise<unknown>) => async (server: { url: string }) => {
  useMockServer(server.url);
  // 앞 상호작용이 남긴 쿠키(가입 토큰 · 문구 등)가 섞이지 않게 비우고 시작한다
  for (const name of Object.keys(cookieValues)) delete cookieValues[name];
  cookieValues[ACCESS_TOKEN_COOKIE] = EXAMPLE_ACCESS_TOKEN;
  cookieValues[REFRESH_TOKEN_COOKIE] = EXAMPLE_REFRESH_TOKEN;
  await call();
};

/** executeTest 콜백: 로그인하지 않은 상태로 FE 함수를 가짜 서버에 보낸다. */
export const asGuest = (call: () => Promise<unknown>) => async (server: { url: string }) => {
  useMockServer(server.url);
  for (const name of Object.keys(cookieValues)) delete cookieValues[name];
  await call();
};

/** Authorization 헤더. 값은 BE 상황이 돌려준 accessToken으로 바뀐다. */
export const bearer = {
  Authorization: MatchersV3.fromProviderState(
    "Bearer ${accessToken}",
    `Bearer ${EXAMPLE_ACCESS_TOKEN}`,
  ),
};

/** BE 상황이 만든 값(id · 날짜 · 이메일)을 넣는 자리. 예: providerValue("applicationId", 12) */
export function providerValue<T extends string | number>(name: string, example: T) {
  return MatchersV3.fromProviderState(`\${${name}}`, example);
}

/** BE 상황이 만든 id가 들어간 경로. 예: providerPath("/applications/${applicationId}", "/applications/12") */
export function providerPath(expression: string, example: string) {
  return MatchersV3.fromProviderState(`/api/v1${expression}`, `/api/v1${example}`);
}

/** "면접" 상황이 만든 면접의 하위 경로. 예: sessionPath("/result") */
export function sessionPath(path: string) {
  return providerPath(`/interview-sessions/\${sessionId}${path}`, `/interview-sessions/55${path}`);
}

/**
 * 응답 모양 비교: 필드마다 타입만 비교하고, FE가 값으로 분기하는 필드(exact)만 값까지 비교한다.
 * exact 값은 equal로 감싸 like · eachLike 안에서도 값으로 비교된다(타입 매처는 하위로 이어짐).
 * 예: shape(home, "homeState")
 */
export function shape<T extends object>(example: T, ...exact: (keyof T)[]) {
  return Object.fromEntries(
    Object.entries(example).map(([key, value]) => [
      key,
      exact.includes(key as keyof T) ? MatchersV3.equal(value) : MatchersV3.like(value),
    ]),
  );
}

/** FE가 라벨 · 색을 찾는 enum 값: 목록마다 값이 달라 equal 대신 FE가 아는 값 중 하나인지 본다. */
export function oneOf<T extends string>(values: readonly T[], example: T) {
  return MatchersV3.regex(`^(${values.join("|")})$`, example);
}

/**
 * 실패 응답(application/problem+json). FE가 읽는 code · detail · errors만 계약에 넣는다(detail은 FE가 보여 줄 때만 넘긴다).
 * code로 분기하는 오류는 code를 값까지, 서버 문구만 보여 주는 오류(generic)는 모양만 비교한다.
 * errors는 FE가 field로 입력 칸을 고르므로 field를 값까지 비교한다(eachLike 안이라 equal로 감싼다).
 * Content-Type을 먼저 정하면 jsonBody가 그 값을 그대로 쓴다(pact FFI with_body).
 */
export function problem<B extends ProblemResponseBuilder<B>>(
  response: B,
  { code, detail, errors }: Pick<ProblemDetail, "code" | "errors"> & { detail?: string },
  { generic = false } = {},
) {
  return response.headers({ "Content-Type": "application/problem+json" }).jsonBody({
    code: generic ? MatchersV3.like(code) : code,
    ...(detail !== undefined && { detail: MatchersV3.like(detail) }),
    ...(errors && {
      errors: MatchersV3.eachLike({
        field: MatchersV3.equal(errors[0].field),
        reason: MatchersV3.like(errors[0].reason),
      }),
    }),
  });
}

interface ProblemResponseBuilder<B> {
  headers(headers: Record<string, string>): B;
  jsonBody(body: unknown): B;
}
