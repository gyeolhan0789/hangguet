// 가입(1.2) · 로그인(1.3)
import { check, fail } from "k6";

import { apiPost, field } from "./api.js";
import { PASSWORD } from "./config.js";

const TERMS = ["TERMS", "PRIVACY", "RECORDING"];
const TERMS_VERSION = "1.0"; // FE TERMS_VERSION과 같다

/** 가입한다. 이미 있는 이메일이면 null */
export function signup(email, nickname) {
  const res = apiPost(
    "/auth/signup",
    {
      email,
      password: PASSWORD,
      nickname,
      agreements: TERMS.map((termsType) => ({ termsType, termsVersion: TERMS_VERSION })),
    },
    null,
    "1.2 POST /auth/signup",
    { expected: [201, 409] },
  );
  if (res.status === 409) {
    return null;
  }
  check(res, { "1.2 가입 201": (r) => r.status === 201 }) || fail(`가입 실패 ${email}: ${res.status} ${res.body}`);
  return { accessToken: field(res, "accessToken"), userId: field(res, "user.id") };
}

/** 로그인해 액세스 토큰을 받는다 */
export function login(email) {
  const res = apiPost("/auth/login", { email, password: PASSWORD }, null, "1.3 POST /auth/login");
  check(res, { "1.3 로그인 200": (r) => r.status === 200 }) || fail(`로그인 실패 ${email}: ${res.status} ${res.body}`);
  return { accessToken: field(res, "accessToken"), userId: field(res, "user.id") };
}
