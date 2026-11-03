// S3 지원서 저장 몰림(load_test_plan 6장, 가설 H2). 단계마다 지원서 N건을 같은 순간에 저장한다(실제 Jev).
//   bash loadtest/run.sh scenarios/s3-application-burst.js                 # 동시 1 · 3 · 5 · 10 · 20 · 30 · 40 · 50건, 단계 사이 1분
//   BURSTS=1,3 REST=20s bash loadtest/run.sh scenarios/s3-application-burst.js  # 짧게 확인
//
// - 지원서 저장(4.1)은 요청 안에서 자소서 검증 결과를 기다린다: BE가 ai:checks에 넣고 최대 8초 BRPOP →
//   AI 기본 큐 작업자(ai-analysis)의 검증 스레드 1개가 하나씩 Jev(시간 제한 5초)를 부른다. 8초 안에 답이 없으면 503
//   (COVER_LETTER_CHECK_UNAVAILABLE). 그래서 동시 저장이 늘면 뒤에 선 저장부터 503이 된다(H2)
// - 계정: seed/accounts-s2.json(지원서 없는 계정)의 앞 최대 단계 수만큼. setup에서 미리 로그인해 로그인 시간이 섞이지 않게 한다
// - per-vu-iterations라 단계의 VU가 같은 순간에 한 번씩 저장한다. 지원서는 지어낸 글 3개를 돌려 쓴다(lib/data.js)
//
// 한계 판정(5.1): 저장 실패(503 포함) ≥ 1% → 기능 한계, 저장 p95 ≥ 1초 → 품질 한계(쓰기). 단계(stage 태그: 5x …)마다 본다
import { check } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import http from "k6/http";
import { Counter } from "k6/metrics";

import { login } from "../lib/auth.js";
import { API, requirePassword } from "../lib/config.js";
import { APPLICATIONS } from "../lib/data.js";

const BURSTS = (__ENV.BURSTS || "1,3,5,10,20,30,40,50").split(",").map(Number);
const REST = __ENV.REST || "1m";
const NAME = "4.1 POST /applications";

const accounts = new SharedArray("s3-accounts", () => JSON.parse(open("../seed/accounts-s2.json")));
const MAX = Math.max(...BURSTS);

const outcomes = new Counter("application_outcomes");

function seconds(duration) {
  const m = /^(\d+)(s|m)$/.exec(duration);
  if (!m) throw new Error(`시간은 30s · 10m 꼴이다: ${duration}`);
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

const scenarios = {};
const thresholds = {};
BURSTS.forEach((n, i) => {
  const tag = `${n}x`;
  scenarios[`save_${tag}`] = {
    executor: "per-vu-iterations",
    exec: "save",
    vus: n,
    iterations: 1,
    startTime: `${i * seconds(REST)}s`,
    maxDuration: "1m",
    tags: { stage: tag },
  };
  thresholds[`http_req_failed{name:${NAME},stage:${tag}}`] = ["rate<0.01"];
  thresholds[`http_req_duration{name:${NAME},stage:${tag}}`] = ["p(95)<1000"];
  // 요약에 단계별 503 수가 나오게 한다
  thresholds[`application_outcomes{outcome:check_unavailable,stage:${tag}}`] = ["count<1"];
});

export const options = {
  scenarios,
  thresholds,
  // setup에서 계정을 차례로 로그인한다(1건 약 0.7초)
  setupTimeout: `${Math.max(60, MAX * 3)}s`,
};

export function setup() {
  requirePassword();
  if (accounts.length < MAX) {
    throw new Error(`계정이 모자란다: ${MAX}개 필요, seed/accounts-s2.json에 ${accounts.length}개(README S2로 만든다)`);
  }
  const tokens = [];
  for (let i = 0; i < MAX; i++) {
    tokens.push(login(accounts[i].email).accessToken);
  }
  // 보고서 그래프(report/charts.mjs)용 단계 시각. 시나리오는 setup 바로 뒤에 시작한다
  const t0 = Math.floor(Date.now() / 1000);
  BURSTS.forEach((n, i) => console.log(`단계 ${n}x\t${t0 + i * seconds(REST)}`));
  return { tokens };
}

export function save(data) {
  const i = exec.scenario.iterationInTest;
  const application = APPLICATIONS[i % APPLICATIONS.length];
  const res = http.post(`${API}/applications`, JSON.stringify(application), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.tokens[i]}` },
    tags: { name: NAME, type: "write" },
    responseCallback: http.expectedStatuses(201),
    timeout: "30s",
  });
  // 201 저장 · 503 검증 못 함(COVER_LETTER_CHECK_UNAVAILABLE) · 400 검증 불합격 · 그 밖
  const outcome = { 201: "saved", 503: "check_unavailable", 400: "unusable" }[res.status] || `status_${res.status}`;
  outcomes.add(1, { outcome });
  check(res, { "4.1 지원서 201": (r) => r.status === 201 });
}

