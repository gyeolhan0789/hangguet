// mock Swagger의 요청 · 응답 예시를 모두 src/types/api 타입으로 적은 TS 파일을 만든다.
// tsc가 예시마다 필드 이름 · 빠진 필드 · 남는 필드 · 타입 · enum 값을 검사하게 하려는 것이다.
// 사용: node scripts/swagger-type-examples.mjs [Swagger JSON 주소 또는 파일]
import fs from "node:fs";

const SOURCE = process.argv[2] ?? "https://hangguet.yobistory.com/mock/be/v3/api-docs";
const OUT = "src/types/api/__tests__/swagger-examples.ts";

/** "메서드 경로 상태" → 응답 타입. 4xx · 5xx는 모두 ProblemDetail */
const RESPONSE_TYPES = {
  "GET /auth/email-availability 200": "EmailAvailabilityResponse",
  "POST /auth/signup 201": "TokenResponse",
  "POST /auth/login 200": "TokenResponse",
  "POST /auth/token/refresh 200": "RefreshResponse",
  "GET /users/me 200": "MeResponse",
  "PATCH /users/me 200": "MeResponse",
  "POST /users/me/profile-image/upload-url 200": "UploadUrlResponse",
  "PUT /users/me/profile-image 200": "MeResponse",
  "GET /home 200": "HomeResponse",
  "GET /users/me/stats 200": "StatsResponse",
  "GET /practice-logs 200": "PracticeLogsResponse",
  "GET /applications 200": "ApplicationListResponse",
  "POST /applications 201": "ApplicationResponse",
  "GET /applications/{applicationId} 200": "ApplicationResponse",
  "PATCH /applications/{applicationId} 200": "ApplicationResponse",
  "POST /interview-sessions 201": "SessionResponse",
  "GET /interview-sessions/{sessionId} 200": "SessionResponse",
  "POST /interview-sessions/{sessionId}/plan/retry 202": "SessionResponse",
  "POST /interview-sessions/{sessionId}/start 200": "SessionResponse",
  "GET /interview-sessions/{sessionId}/questions/current 200": "QuestionResponse",
  "GET /interview-sessions/{sessionId}/questions/current 202": "PendingResponse",
  "POST /interview-sessions/{sessionId}/questions/{questionId}/answer-audio/upload-url 200":
    "UploadUrlResponse",
  "POST /interview-sessions/{sessionId}/questions/{questionId}/answer 202": "AnswerResponse",
  "POST /interview-sessions/{sessionId}/end 200": "SessionResponse",
  "POST /interview-sessions/{sessionId}/end 202": "SessionResponse",
  "POST /interview-sessions/{sessionId}/analysis/retry 202": "SessionResponse",
  "POST /interview-sessions/{sessionId}/stt-token 200": "SttTokenResponse",
  "POST /interview-sessions/{sessionId}/questions/{questionId}/reactions 200": "ReactionResponse",
  "POST /interview-sessions/{sessionId}/recordings/upload-url 200": "UploadUrlResponse",
  "POST /interview-sessions/{sessionId}/recordings 201": "RecordingResponse",
  "GET /interview-sessions/{sessionId}/result 200": "ResultResponse",
  "GET /interview-sessions/{sessionId}/replay 200": "ReplayResponse",
  "GET /growth-reviews/{practiceDate} 200": "GrowthReviewResponse",
  "GET /growth-reviews 200": "RecentReviewsResponse",
};

/** "메서드 경로" → 요청 본문 타입 */
const REQUEST_TYPES = {
  "POST /auth/signup": "SignupRequest",
  "POST /auth/login": "LoginRequest",
  "POST /auth/token/refresh": "RefreshRequest",
  "POST /auth/logout": "LogoutRequest",
  "POST /users/me": "WithdrawRequest",
  "PATCH /users/me": "NicknameRequest",
  "PATCH /users/me/password": "PasswordChangeRequest",
  "POST /users/me/profile-image/upload-url": "ProfileImageUploadUrlRequest",
  "PUT /users/me/profile-image": "ProfileImageRequest",
  "POST /applications": "ApplicationCreateRequest",
  "PATCH /applications/{applicationId}": "ApplicationUpdateRequest",
  "POST /interview-sessions": "SessionCreateRequest",
  "POST /interview-sessions/{sessionId}/questions/{questionId}/answer-audio/upload-url":
    "AnswerAudioUploadUrlRequest",
  "POST /interview-sessions/{sessionId}/questions/{questionId}/answer": "AnswerRequest",
  "POST /interview-sessions/{sessionId}/questions/{questionId}/reactions": "ReactionRequest",
  "POST /interview-sessions/{sessionId}/recordings/upload-url": "RecordingUploadUrlRequest",
  "POST /interview-sessions/{sessionId}/recordings": "RecordingCreateRequest",
};

const spec = SOURCE.startsWith("http")
  ? await (await fetch(SOURCE)).json()
  : JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const schemas = spec.components.schemas;

/** 컴포넌트 스키마의 필드별 example로 요청 예시를 만든다(예시가 따로 없는 요청용) */
function exampleFromSchema(ref) {
  const schema = schemas[ref.split("/").pop()];
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, prop]) => {
      if (prop.example !== undefined) return [key, prop.example];
      if (prop.type === "array" && prop.items?.$ref)
        return [key, [exampleFromSchema(prop.items.$ref)]];
      if (prop.$ref) return [key, exampleFromSchema(prop.$ref)];
      if (prop.enum) return [key, prop.enum[0]];
      throw new Error(`${ref}.${key}에 example이 없어요.`);
    }),
  );
}

const examplesOf = (content) => {
  const media = Object.values(content)[0];
  if (media.example !== undefined) return [["", media.example]];
  if (media.examples) return Object.entries(media.examples).map(([name, e]) => [name, e.value]);
  if (media.schema?.$ref) return [["스키마 example", exampleFromSchema(media.schema.$ref)]];
  return [];
};

const entries = [];
const missing = [];
for (const [rawPath, ops] of Object.entries(spec.paths)) {
  const path = rawPath.replace(/^\/api\/v1/, "");
  for (const [method, op] of Object.entries(ops)) {
    const key = `${method.toUpperCase()} ${path}`;
    if (op.requestBody) {
      const type = REQUEST_TYPES[key];
      if (!type) missing.push(`요청 ${key}`);
      for (const [name, value] of examplesOf(op.requestBody.content)) {
        entries.push({ label: `${op.summary} 요청 ${name}`.trim(), type, value });
      }
    }
    for (const [status, response] of Object.entries(op.responses)) {
      if (!response.content) continue;
      const type = Number(status) >= 400 ? "ProblemDetail" : RESPONSE_TYPES[`${key} ${status}`];
      if (!type) missing.push(`응답 ${key} ${status}`);
      for (const [name, value] of examplesOf(response.content)) {
        entries.push({ label: `${op.summary} ${status} ${name}`.trim(), type, value });
      }
    }
  }
}
if (missing.length) throw new Error(`타입을 정하지 않은 예시가 있어요:\n${missing.join("\n")}`);

const types = [...new Set(entries.map((e) => e.type))].sort();
const body = entries
  .map((e) => `  // ${e.label}\n  ${JSON.stringify(e.value)} satisfies ${e.type},`)
  .join("\n");
fs.mkdirSync("src/types/api/__tests__", { recursive: true });
fs.writeFileSync(
  OUT,
  `// 자동 생성 파일(scripts/swagger-type-examples.mjs). 직접 고치지 않는다.
// mock Swagger의 요청 · 응답 예시 ${entries.length}개를 src/types/api 타입으로 적는다. tsc가 하나라도 맞지 않으면 실패한다.
import type {\n${types.map((t) => `  ${t},`).join("\n")}\n} from "..";

export const SWAGGER_EXAMPLE_COUNT = ${entries.length};

export const swaggerExamples = [\n${body}\n];
`,
);
console.log(`${OUT}: 예시 ${entries.length}개`);
