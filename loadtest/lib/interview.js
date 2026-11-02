// 지원서(4.1) · 면접 진행(5.x) · 결과(6.3) 호출. 시간은 시나리오가 사용자 지표로 남긴다.
import { check, sleep } from "k6";

import { apiGet, apiPost, field } from "./api.js";

/** 지원서를 저장한다(자소서 검증 Jev를 기다린다, 최대 8초). 실패하면 null */
export function createApplication(token, application) {
  const res = apiPost("/applications", application, token, "4.1 POST /applications");
  const ok = check(res, { "4.1 지원서 201": (r) => r.status === 201 });
  return { res, id: ok ? field(res, "id") : null };
}

/** 면접을 만든다(5.1). 실패하면 null */
export function createSession(token, applicationId, persona, mode) {
  const res = apiPost(
    "/interview-sessions",
    { applicationId, persona, mode },
    token,
    "5.1 POST /interview-sessions",
    { idempotent: true },
  );
  const ok = check(res, { "5.1 면접 만들기 201": (r) => r.status === 201 });
  return ok ? field(res, "id") : null;
}

export function getSession(token, sessionId) {
  return apiGet(`/interview-sessions/${sessionId}`, token, "5.2 GET /interview-sessions/{id}");
}

/**
 * done(session)이 true가 될 때까지 intervalSeconds마다 5.2를 부른다(화면의 2초 폴링).
 * 마지막 응답 본문과 걸린 시간(초)을 돌려준다. timeoutSeconds를 넘기면 timedOut
 */
export function pollSession(token, sessionId, done, { intervalSeconds = 2, timeoutSeconds = 200 } = {}) {
  const started = Date.now();
  let session = null;
  while ((Date.now() - started) / 1000 < timeoutSeconds) {
    const res = getSession(token, sessionId);
    if (res.status === 200) {
      session = res.json();
      if (done(session)) {
        return { session, seconds: (Date.now() - started) / 1000, timedOut: false };
      }
    }
    sleep(intervalSeconds);
  }
  return { session, seconds: (Date.now() - started) / 1000, timedOut: true };
}

/** 면접을 시작한다(5.4) */
export function startSession(token, sessionId) {
  const res = apiPost(`/interview-sessions/${sessionId}/start`, undefined, token, "5.4 POST /interview-sessions/{id}/start", {
    idempotent: true,
  });
  return check(res, { "5.4 면접 시작 200": (r) => r.status === 200 });
}

/** 지금 질문(5.5)이 나올 때까지 기다린다. 202(질문 준비 중)면 intervalSeconds 뒤 다시 묻는다 */
export function waitQuestion(token, sessionId, { intervalSeconds = 1, timeoutSeconds = 60 } = {}) {
  const started = Date.now();
  while ((Date.now() - started) / 1000 < timeoutSeconds) {
    const res = apiGet(`/interview-sessions/${sessionId}/questions/current`, token, "5.5 GET /questions/current");
    if (res.status === 200) {
      return { question: res.json(), seconds: (Date.now() - started) / 1000 };
    }
    if (res.status !== 202) {
      return { question: null, seconds: (Date.now() - started) / 1000, status: res.status, body: res.body };
    }
    sleep(intervalSeconds);
  }
  return { question: null, seconds: (Date.now() - started) / 1000, status: "timeout" };
}

/** 채팅 답변(5.7). 마지막 질문이면 true */
export function answerText(token, sessionId, questionId, content) {
  const res = apiPost(
    `/interview-sessions/${sessionId}/questions/${questionId}/answer`,
    { inputType: "TEXT", content },
    token,
    "5.7 POST /questions/{id}/answer",
    { idempotent: true },
  );
  check(res, { "5.7 답변 202": (r) => r.status === 202 });
  return { ok: res.status === 202, last: field(res, "isLastQuestion") === true };
}

/** 면접을 끝낸다(5.8). 분석이 남았으면 202, 바로 끝났으면 200 */
export function endSession(token, sessionId) {
  const res = apiPost(`/interview-sessions/${sessionId}/end`, undefined, token, "5.8 POST /interview-sessions/{id}/end", {
    idempotent: true,
  });
  return check(res, { "5.8 면접 끝내기 200/202": (r) => r.status === 200 || r.status === 202 });
}

export function getResult(token, sessionId) {
  const res = apiGet(`/interview-sessions/${sessionId}/result`, token, "6.3 GET /interview-sessions/{id}/result");
  return check(res, { "6.3 결과 200": (r) => r.status === 200 });
}
