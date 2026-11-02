// BE API 호출(load_test_plan 6장 "S1 · S4 요청 방식": 쓰기는 BE를 직접 부른다).
// name 태그로 주소를 묶어 면접 id마다 지표가 따로 생기지 않게 한다. type 태그(read · write)로 5.1 기준을 나눈다.
import http from "k6/http";

import { API, BASE_URL } from "./config.js";

function params(token, { name, type = "read", idempotent = false, extraHeaders = {} } = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (idempotent) {
    // 5.1 · 5.4 · 5.7 · 5.8은 Idempotency-Key가 필요하다
    headers["Idempotency-Key"] = crypto.randomUUID();
  }
  return { headers, tags: { name, type }, responseCallback: http.expectedStatuses({ min: 200, max: 399 }) };
}

export function apiGet(path, token, name) {
  return http.get(`${API}${path}`, params(token, { name, type: "read" }));
}

export function apiPost(path, body, token, name, { idempotent = false, expected } = {}) {
  const p = params(token, { name, type: "write", idempotent });
  if (expected) {
    p.responseCallback = http.expectedStatuses(...expected);
  }
  return http.post(`${API}${path}`, body === undefined ? null : JSON.stringify(body), p);
}

/** FE 페이지 GET. 로그인 쿠키(hk_access)를 붙이고, 로그인 화면으로 보내면(3xx) 실패로 본다 */
export function page(path, token, name, { rsc = false } = {}) {
  const headers = {};
  if (rsc) {
    // 화면의 다시 그리기(router.refresh)와 같은 요청(load_test_plan 4.1)
    headers.RSC = "1";
  }
  return http.get(`${BASE_URL}${path}`, {
    headers,
    cookies: { hk_access: token },
    redirects: 0,
    tags: { name, type: "page" },
    responseCallback: http.expectedStatuses(200),
  });
}

/** 응답 JSON 필드. 본문이 JSON이 아니면 undefined */
export function field(res, path) {
  try {
    return res.json(path);
  } catch (_) {
    return undefined;
  }
}
