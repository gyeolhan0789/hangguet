// S4 면접 만들기 몰림(load_test_plan 6장, 가설 H1 · H5). 1분 동안 면접 N건을 만들고, 사용자마다 질문 준비가 끝날 때까지
// 화면처럼 2초마다 장치 점검 화면을 다시 그린다(실제 GMS).
//   bash loadtest/run.sh scenarios/s4-plan-burst.js                       # 1분에 5 · 10 · 20 · 30 · 40 · 50건(약 28분)
//   RATES=2 bash loadtest/run.sh scenarios/s4-plan-burst.js                # 짧게 확인
//
// - 면접 만들기(5.1)는 BE API를 직접 부른다. 질문 준비(PLAN)는 ai-plan 작업자 1개가 차례로 GMS를 2번씩 부른다(H1).
//   요청 시각부터 3분이 지나면 FAILED(TIMED_OUT)가 된다(ai/app/interview/plan/job.py PLAN_TIMEOUT_SECONDS)
// - 기다리는 동안은 화면(plan-progress.tsx)처럼 /practice/devices?sessionId=…를 RSC로 2초마다 다시 그린다(H5, lib/plan-wait.js).
//   질문 준비 상태는 그 응답에서 읽는다(planStatus가 GENERATING이 아니면 끝)
// - 면접 시작(5.4)은 하지 않는다(에이전트가 배정되므로, 계획 6장). 만든 면접은 READY로 남는다
// - 계정: seed/accounts-s2.json의 앞 ACCOUNTS개(지원서가 있어야 한다. S3를 돌리면 생긴다). setup에서 미리 로그인한다
//
// 한계 판정(5.1): 질문 준비 실패(FAILED · 3분 초과) → 기능 한계, 화면 다시 그리기 p95 ≥ 1.5초 → 품질 한계
import { check } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";

import { apiGet, field } from "../lib/api.js";
import { login } from "../lib/auth.js";
import { requirePassword } from "../lib/config.js";
import { createSession } from "../lib/interview.js";
import { PLAN_PAGE, waitPlanReady } from "../lib/plan-wait.js";

const RATES = (__ENV.RATES || "5,10,20,30,40,50").split(",").map(Number);
const ACCOUNTS = Number(__ENV.ACCOUNTS || 30);
const GIVE_UP_SECONDS = 240; // 마감(3분) 뒤 FAILED가 화면에 나올 때까지 여유

const accounts = new SharedArray("s4-accounts", () => JSON.parse(open("../seed/accounts-s2.json")));

const planReady = new Trend("plan_ready_seconds");
const outcomes = new Counter("plan_outcomes");
const polls = new Counter("plan_polls");

// 일정: 단계마다 1분 동안 만들고, 질문 준비 줄이 빠질 때까지(1건 약 7초로 잡음) + 1분 쉰다
const schedule = [];
let at = 0;
for (const n of RATES) {
  schedule.push({ n, tag: `${n}pm`, start: at });
  at += 60 + n * 7 + 60;
}

const scenarios = {};
const thresholds = {};
for (const s of schedule) {
  scenarios[`plan_${s.tag}`] = {
    executor: "constant-arrival-rate",
    exec: "createAndWait",
    rate: s.n,
    timeUnit: "1m",
    duration: "1m",
    startTime: `${s.start}s`,
    preAllocatedVUs: s.n,
    maxVUs: s.n,
    gracefulStop: `${GIVE_UP_SECONDS + 30}s`,
    tags: { stage: s.tag },
  };
  thresholds[`plan_outcomes{outcome:failed,stage:${s.tag}}`] = ["count<1"];
  thresholds[`plan_outcomes{outcome:gave_up,stage:${s.tag}}`] = ["count<1"];
  thresholds[`plan_ready_seconds{stage:${s.tag}}`] = ["max<180"];
  thresholds[`http_req_duration{name:${PLAN_PAGE},stage:${s.tag}}`] = ["p(95)<1500"];
}

export const options = {
  scenarios,
  thresholds,
  setupTimeout: `${Math.max(60, ACCOUNTS * 3)}s`,
};

export function setup() {
  requirePassword();
  const users = [];
  for (let i = 0; i < Math.min(ACCOUNTS, accounts.length); i++) {
    const token = login(accounts[i].email).accessToken;
    const applicationId = field(apiGet("/applications?size=1", token, "4.3 GET /applications"), "content.0.id");
    if (!applicationId) {
      throw new Error(`${accounts[i].email}에 지원서가 없다(S3를 먼저 돌리거나 seed.js WITH_APPLICATION=1)`);
    }
    users.push({ token, applicationId });
  }
  const t0 = Math.floor(Date.now() / 1000);
  for (const s of schedule) console.log(`단계 ${s.tag}\t${t0 + s.start}\t${t0 + s.start + 60}`);
  return { users };
}

export function createAndWait(data) {
  const user = data.users[exec.scenario.iterationInTest % data.users.length];
  const sessionId = createSession(user.token, user.applicationId, "COFFEE_CHAT", "VIDEO");
  if (!sessionId) {
    outcomes.add(1, { outcome: "create_failed" });
    return;
  }
  const plan = waitPlanReady(user.token, sessionId, { giveUpSeconds: GIVE_UP_SECONDS });
  polls.add(plan.polls);
  if (plan.status === null) {
    outcomes.add(1, { outcome: "gave_up" });
    console.warn(`면접 ${sessionId} 질문 준비 ${GIVE_UP_SECONDS}초 넘게 끝나지 않음(마지막 응답 ${plan.lastStatus})`);
    return;
  }
  const { status, seconds } = plan;
  if (status === "READY") {
    planReady.add(seconds);
    outcomes.add(1, { outcome: "ready" });
  } else {
    outcomes.add(1, { outcome: "failed" });
    console.warn(`면접 ${sessionId} 질문 준비 실패(${seconds.toFixed(0)}초)`);
  }
  check(status, { "질문 준비 READY": (s) => s === "READY" });
}
