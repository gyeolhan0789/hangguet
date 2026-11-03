// S2 로그인 몰림(load_test_plan 6장, 가설 H3). 1분 동안 로그인 N건을 고르게 보내는 단계를 30 → 100 → 200 … 으로 올린다.
//   bash loadtest/run.sh scenarios/s2-login-burst.js                                  # 30 · 100 · 200 · 400 · 600 · 800건/분(약 20분)
//   LOGINS=30,100 WARMUP=30s REST=30s bash loadtest/run.sh scenarios/s2-login-burst.js  # 짧게 확인
//
// - 로그인 계정: seed/accounts-s2.json(seed.js로 계정만 만든다, README). 단계마다 다른 계정부터 돌려 쓴다
// - 같은 시간에 S1을 L1(WEB_RATE, 기본 5 req/s)로 깐다(lib/web-mix.js). 로그인 해시(PBKDF2 310,000회)가 CPU를 차지할 때
//   다른 화면도 느려지는지 본다. 배경 부하는 WARMUP 동안 먼저 돌아 기준값을 만든다
// - 단계 사이 REST 동안 로그인을 쉬어, 단계마다 서버가 원래대로 돌아오는지 본다
// - constant-arrival-rate라 응답이 느려져도 보내는 양이 줄지 않는다. 로그인이 1분 안에 다 못 끝나면 늦게 끝난 요청까지 그 단계로 센다
//
// 한계 판정(5.1): 로그인 p95 ≥ 1초 · 화면 p95 ≥ 1.5초 → 품질 한계, 실패율 ≥ 1% → 기능 한계. 단계(stage 태그: 30pm …)마다 따로 본다
import { check } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

import { LOGIN_NAME, loginRequest } from "../lib/auth.js";
import { requirePassword } from "../lib/config.js";
import { browse } from "../lib/web-mix.js";

const LOGINS = (__ENV.LOGINS || "30,100,200,400,600,800").split(",").map(Number);
const WARMUP = __ENV.WARMUP || "2m";
const REST = __ENV.REST || "2m";
const WEB_RATE = Number(__ENV.WEB_RATE || 5);

const loginAccounts = new SharedArray("s2-accounts", () => JSON.parse(open("../seed/accounts-s2.json")));

function seconds(duration) {
  const m = /^(\d+)(s|m)$/.exec(duration);
  if (!m) throw new Error(`시간은 30s · 10m 꼴이다: ${duration}`);
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

// 일정(테스트 시작 기준 초): 배경 부하 WARMUP → [로그인 1분 → 쉼 REST] × 단계
const BURST = 60;
const schedule = [];
let at = seconds(WARMUP);
let accountOffset = 0;
for (const n of LOGINS) {
  schedule.push({ n, tag: `${n}pm`, start: at, end: at + BURST, accountOffset });
  at += BURST + seconds(REST);
  accountOffset += n;
}
const TOTAL = at;

/** 배경 부하 요청이 어느 단계에 들어가는지(로그인 중이면 그 단계, 아니면 base · rest) */
function webStageTag() {
  const t = (Date.now() - exec.scenario.startTime) / 1000;
  if (t < schedule[0].start) return "base";
  const s = schedule.find((x) => t >= x.start && t < x.end);
  return s ? s.tag : "rest";
}

const scenarios = {
  web: {
    executor: "constant-arrival-rate",
    exec: "web",
    rate: WEB_RATE,
    timeUnit: "1s",
    duration: `${TOTAL}s`,
    preAllocatedVUs: 20,
    maxVUs: 200,
  },
};
const thresholds = {
  // 안전장치: 실패율 5%가 1분 넘게 이어지면 멈춘다(3.5)
  http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "1m" }],
  "http_req_duration{type:page,stage:base}": ["p(95)<1500"],
};
for (const s of schedule) {
  scenarios[`login_${s.tag}`] = {
    executor: "constant-arrival-rate",
    exec: "burst",
    rate: s.n,
    timeUnit: "1m",
    duration: "1m",
    startTime: `${s.start}s`,
    // 로그인이 30초씩 걸려도 보낼 수 있게 미리 만들고, 1분 내내 걸려도 되도록 최대는 단계 건수만큼.
    // 실행 중에 VU를 새로 만들면 그동안 보낼 요청을 버린다(11/02 본 회차 400 · 600 · 800건에서 51 · 171 · 265건)
    preAllocatedVUs: Math.min(s.n, Math.max(5, Math.ceil((s.n / 60) * 30))),
    maxVUs: s.n,
    gracefulStop: "3m",
    tags: { stage: s.tag },
    env: { ACCOUNT_OFFSET_S2: String(s.accountOffset) },
  };
  thresholds[`http_req_duration{name:${LOGIN_NAME},stage:${s.tag}}`] = ["p(95)<1000"];
  thresholds[`http_req_failed{name:${LOGIN_NAME},stage:${s.tag}}`] = ["rate<0.01"];
  thresholds[`http_req_duration{type:page,stage:${s.tag}}`] = ["p(95)<1500"];
  thresholds[`http_req_failed{type:page,stage:${s.tag}}`] = ["rate<0.01"];
  thresholds[`dropped_iterations{scenario:login_${s.tag}}`] = ["count<1"];
}

export const options = { scenarios, thresholds };

export function setup() {
  requirePassword();
  if (loginAccounts.length === 0) {
    throw new Error("seed/accounts-s2.json이 비었다(README S2: seed.js로 계정을 만든다)");
  }
  // 보고서 그래프(report/charts.mjs)용 단계 시각. 시나리오는 setup 바로 뒤에 시작한다
  const t0 = Math.floor(Date.now() / 1000);
  for (const s of schedule) {
    console.log(`단계 ${s.tag}\t${t0 + s.start}\t${t0 + s.end}`);
  }
  console.log(`끝\t${t0 + TOTAL}`);
}

export function web() {
  browse({ stage: webStageTag() });
}

export function burst() {
  const offset = Number(__ENV.ACCOUNT_OFFSET_S2 || 0);
  const me = loginAccounts[(offset + exec.scenario.iterationInTest) % loginAccounts.length];
  const res = loginRequest(me.email);
  check(res, { "1.3 로그인 200": (r) => r.status === 200 });
}
