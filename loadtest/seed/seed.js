// 테스트 계정 · 지원서 만들기(load_test_plan 3.6). 회차 전에 한 번 돌린다. 다시 돌려도 이미 있는 계정 · 지원서는 그대로 쓴다.
//   COUNT=20 START=1 bash loadtest/run.sh seed/seed.js
//   COUNT=300 START=101 WITH_APPLICATION=0 ACCOUNTS_FILE=seed/accounts-s2.json bash loadtest/run.sh seed/seed.js  # S2 로그인용(계정만)
// 결과: ACCOUNTS_FILE(기본 seed/accounts.json, 계정 번호 · 이메일 · 회원 id · 지원서 id, 비밀번호 없음). 커밋하지 않는다.
// WITH_APPLICATION=0이면 지원서를 만들지 않는다(자소서 검증 · Jev를 부르지 않아 계정 수백 개도 몇 분이면 된다).
// 가입 부하가 결과에 섞이지 않도록 한 계정씩 차례로 만든다.
import { check, fail } from "k6";

import { apiGet, field } from "../lib/api.js";
import { login, signup } from "../lib/auth.js";
import { accountEmail, requirePassword } from "../lib/config.js";
import { APPLICATIONS } from "../lib/data.js";
import { createApplication } from "../lib/interview.js";

const COUNT = Number(__ENV.COUNT || 1);
const START = Number(__ENV.START || 1);
const WITH_APPLICATION = __ENV.WITH_APPLICATION !== "0";
const ACCOUNTS_FILE = __ENV.ACCOUNTS_FILE || "seed/accounts.json";

export const options = {
  // 지원서 저장은 자소서 검증(최대 8초)을 기다리므로 넉넉히 둔다
  setupTimeout: `${Math.max(60, COUNT * 20)}s`,
  scenarios: { noop: { executor: "shared-iterations", vus: 1, iterations: 1 } },
};

function existingApplicationId(token) {
  const res = apiGet("/applications?size=1", token, "4.3 GET /applications");
  check(res, { "4.3 지원서 목록 200": (r) => r.status === 200 });
  return field(res, "content.0.id") ?? null;
}

export function setup() {
  requirePassword();
  const accounts = [];
  for (let index = START; index < START + COUNT; index++) {
    const email = accountEmail(index);
    const signed = signup(email, `부하테스트${index}`);
    const session = signed ?? login(email);
    let applicationId = WITH_APPLICATION ? existingApplicationId(session.accessToken) : null;
    if (WITH_APPLICATION && !applicationId) {
      const created = createApplication(session.accessToken, APPLICATIONS[index % APPLICATIONS.length]);
      applicationId = created.id;
      if (!applicationId) {
        fail(`지원서 저장 실패 ${email}: ${created.res.status} ${created.res.body}`);
      }
    }
    accounts.push({ index, email, userId: session.userId, applicationId });
    console.log(`${signed ? "가입" : "있음"} ${email} user=${session.userId} application=${applicationId}`);
  }
  return accounts;
}

export default function () {}

export function handleSummary(data) {
  const accounts = data.setup_data || [];
  return {
    [ACCOUNTS_FILE]: JSON.stringify(accounts, null, 2),
    stdout: `계정 ${accounts.length}개 → ${ACCOUNTS_FILE}\n`,
  };
}
