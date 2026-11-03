// S6 피크 혼합(load_test_plan 6장, 가설 전부). S1 화면 · S2 로그인 · S4 면접 만들기 · S5 화상 면접을 한 스크립트에서 같이 돌리고
// 단계(L1 → L2 → L3)마다 같은 비율로 올린다. 따로 돌렸을 때(S1 · S2 · S4 · S5 보고서)보다 한계가 얼마나 낮아지는지 본다.
//   bash loadtest/run.sh scenarios/s6-peak-browser.js                                   # 기본 L1 10분 · L2 30분 · L3 10분(약 1시간)
//   MIX=2/20/1/1/3m REST=1m bash loadtest/run.sh scenarios/s6-peak-browser.js            # 짧게 확인
//
// - MIX: 단계마다 "화면 req/s / 로그인 건/분 / 면접 만들기 건/분 / 동시 화상 면접 / 유지 시간"을 쉼표로 잇는다.
//   기본값은 따로 잰 한계의 약 25 · 50 · 75%다(화면 지속 약 19 req/s, 로그인 약 290건/분, 질문 준비 약 12건/분, 화상 면접 지속 약 5건)
// - 단계 사이는 REST(기본 2분) 쉰다. 단계가 끝날 때 진행 중이던 질문 준비 · 화상 면접은 끝까지 기다리므로(gracefulStop)
//   다음 단계 앞부분과 겹칠 수 있다. 지표는 시작한 단계(stage 태그: L1 · L2 · L3)로 센다
// - 흐름은 각 시나리오와 같은 공통 모듈을 쓴다: 화면 lib/web-mix.js · 로그인 lib/auth.js loginRequest ·
//   질문 준비 lib/plan-wait.js · 화상 면접 lib/video-interview-run.js
// - 계정: 화면 · 화상 면접은 seed/accounts.json(끝낸 면접 · 지원서가 있는 1~10번), 로그인 · 면접 만들기는 seed/accounts-s2.json
//   (면접 만들기는 지원서가 있는 앞 PLAN_ACCOUNTS개, setup에서 미리 로그인). 화상 면접이 같은 계정을 동시에 쓸 수 있지만
//   계정당 진행 중 면접 수 제한이 없어 진행에는 영향이 없다
// - 외부 API는 실제 API(GMS · Soniox · ElevenLabs · Jev)다. 화면 3D(WebGL)는 끈다(run.sh)
//
// 한계 판정(5.1)은 단계마다: 화면 p95 ≥ 1.5초 · 로그인 p95 ≥ 1초(품질), 질문 준비 실패 · 화상 면접 실패 · 녹화 실패(기능),
// 서버 CPU 평균 ≥ 40%가 10분 넘게(지속 가능, server/resources.sh · Grafana)
import { check } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

import { account } from "../lib/accounts.js";
import { apiGet, field } from "../lib/api.js";
import { LOGIN_NAME, login, loginRequest } from "../lib/auth.js";
import { requirePassword } from "../lib/config.js";
import { createSession } from "../lib/interview.js";
import { PLAN_PAGE, waitPlanReady } from "../lib/plan-wait.js";
import { runVideoInterviewOnce, planReady } from "../lib/video-interview-run.js";
import { browse } from "../lib/web-mix.js";

const MIX = (__ENV.MIX || "5/70/3/2/10m,10/150/6/3/30m,15/220/9/5/10m").split(",").map((level, i) => {
  const [web, logins, plans, interviews, hold] = level.split("/");
  return { tag: `L${i + 1}`, web: Number(web), logins: Number(logins), plans: Number(plans), interviews: Number(interviews), hold };
});
const REST = __ENV.REST || "2m";
const PLAN_ACCOUNTS = Number(__ENV.PLAN_ACCOUNTS || 30);
const PLAN_GIVE_UP_SECONDS = 240; // 마감(3분) 뒤 FAILED가 화면에 나올 때까지 여유
const VIDEO_START_SPREAD_SECONDS = 30; // 화상 면접 VU가 같은 순간에 시작하지 않게 첫 면접을 0~30초 안에서 벌린다

const s2Accounts = new SharedArray("s6-s2-accounts", () => JSON.parse(open("../seed/accounts-s2.json")));

const planOutcomes = new Counter("plan_outcomes");

function seconds(duration) {
  const m = /^(\d+)(s|m)$/.exec(duration);
  if (!m) throw new Error(`시간은 30s · 10m 꼴이다: ${duration}`);
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

// 일정(테스트 시작 기준 초)
const schedule = [];
let at = 0;
let videoOffset = 0;
for (const level of MIX) {
  schedule.push({ ...level, start: at, end: at + seconds(level.hold), videoOffset });
  at += seconds(level.hold) + seconds(REST);
  videoOffset += level.interviews;
}

const scenarios = {};
const thresholds = {
  // 안전장치: 실패율 5%가 2분 넘게 이어지면 멈춘다(3.5)
  http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "2m" }],
};
for (const s of schedule) {
  const common = { startTime: `${s.start}s`, tags: { stage: s.tag } };
  if (s.web > 0) {
    scenarios[`web_${s.tag}`] = {
      ...common,
      executor: "constant-arrival-rate",
      exec: "web",
      rate: s.web,
      timeUnit: "1s",
      duration: s.hold,
      preAllocatedVUs: Math.max(5, s.web * 2),
      maxVUs: 200,
    };
  }
  if (s.logins > 0) {
    scenarios[`login_${s.tag}`] = {
      ...common,
      executor: "constant-arrival-rate",
      exec: "loginOnce",
      rate: s.logins,
      timeUnit: "1m",
      duration: s.hold,
      // 실행 중에 VU를 새로 만들면 그동안 보낼 요청을 버린다(S2 보고서). 로그인이 30초씩 걸려도 되게 미리 만든다
      preAllocatedVUs: Math.min(s.logins, Math.max(5, Math.ceil((s.logins / 60) * 30))),
      maxVUs: s.logins,
      gracefulStop: "1m",
      env: { S6_LOGIN_OFFSET: String(PLAN_ACCOUNTS) },
    };
  }
  if (s.plans > 0) {
    scenarios[`plan_${s.tag}`] = {
      ...common,
      executor: "constant-arrival-rate",
      exec: "createAndWait",
      rate: s.plans,
      timeUnit: "1m",
      duration: s.hold,
      // 1건이 길면 4분 기다린다(질문 준비 줄 + 마감)
      preAllocatedVUs: Math.max(2, s.plans * 4),
      maxVUs: Math.max(4, s.plans * 6),
      gracefulStop: `${PLAN_GIVE_UP_SECONDS + 30}s`,
    };
  }
  if (s.interviews > 0) {
    scenarios[`video_${s.tag}`] = {
      ...common,
      executor: "constant-vus",
      exec: "video",
      vus: s.interviews,
      duration: s.hold,
      // 진행 중인 면접은 결과 · 다시보기까지 끝나게 둔다(면접 약 2분 + 결과 · 합치기 대기)
      gracefulStop: "10m",
      options: { browser: { type: "chromium" } },
      env: { S6_VIDEO_OFFSET: String(s.videoOffset) },
    };
  }
  const t = `stage:${s.tag}`;
  thresholds[`http_req_duration{type:page,${t}}`] = ["p(95)<1500"];
  thresholds[`http_req_duration{name:${LOGIN_NAME},${t}}`] = ["p(95)<1000"];
  thresholds[`http_req_failed{name:${LOGIN_NAME},${t}}`] = ["rate<0.01"];
  thresholds[`http_req_duration{name:${PLAN_PAGE},${t}}`] = ["p(95)<1500"];
  thresholds[`plan_outcomes{outcome:failed,${t}}`] = ["count<1"];
  thresholds[`plan_outcomes{outcome:gave_up,${t}}`] = ["count<1"];
  thresholds[`plan_ready_seconds{${t}}`] = ["max<180"];
  thresholds[`interview_failed{${t}}`] = ["count<1"];
  thresholds[`replay_failed{${t}}`] = ["count<1"];
  thresholds[`first_question_seconds{${t}}`] = ["max<120"];
  thresholds[`question_gap_seconds{${t}}`] = ["p(95)<40"];
  thresholds[`evaluation_seconds{${t}}`] = ["max<600"];
}

export const options = {
  scenarios,
  thresholds,
  setupTimeout: `${Math.max(60, PLAN_ACCOUNTS * 3)}s`,
};

export function setup() {
  requirePassword();
  const needed = Math.max(...MIX.map((l) => l.plans)) > 0 ? PLAN_ACCOUNTS : 0;
  if (s2Accounts.length < needed) {
    throw new Error(`seed/accounts-s2.json 계정이 모자란다: ${needed}개 필요(README S2)`);
  }
  // 면접 만들기 계정: 미리 로그인하고 지원서 id를 받아 둔다(액세스 토큰은 9시간 유효)
  const planUsers = [];
  for (let i = 0; i < needed; i++) {
    const token = login(s2Accounts[i].email).accessToken;
    const applicationId = field(apiGet("/applications?size=1", token, "4.3 GET /applications"), "content.0.id");
    if (!applicationId) {
      throw new Error(`${s2Accounts[i].email}에 지원서가 없다(S3를 먼저 돌리거나 seed.js WITH_APPLICATION=1)`);
    }
    planUsers.push({ token, applicationId });
  }
  // 보고서 그래프(report/charts.mjs) · resources.sh용 단계 시각. 시나리오는 setup 바로 뒤에 시작한다
  const t0 = Math.floor(Date.now() / 1000);
  for (const s of schedule) {
    console.log(`단계 ${s.tag}\t${t0 + s.start}\t${t0 + s.end}\t화면 ${s.web}/초 · 로그인 ${s.logins}/분 · 면접 만들기 ${s.plans}/분 · 화상 면접 ${s.interviews}건`);
  }
  return { planUsers };
}

/** S1: 화면 하나 */
export function web() {
  browse();
}

/** S2: 로그인 하나. 단계마다 다른 계정부터 돌려 쓴다 */
export function loginOnce() {
  const offset = Number(__ENV.S6_LOGIN_OFFSET || 0);
  const me = s2Accounts[(offset + exec.scenario.iterationInTest) % s2Accounts.length];
  const res = loginRequest(me.email);
  check(res, { "1.3 로그인 200": (r) => r.status === 200 });
}

/** S4: 면접 만들기 → 질문 준비 완료까지 화면처럼 2초 폴링(면접 시작은 하지 않는다) */
export function createAndWait(data) {
  const user = data.planUsers[exec.scenario.iterationInTest % data.planUsers.length];
  const sessionId = createSession(user.token, user.applicationId, "COFFEE_CHAT", "VIDEO");
  if (!sessionId) {
    planOutcomes.add(1, { outcome: "create_failed" });
    return;
  }
  const plan = waitPlanReady(user.token, sessionId, { giveUpSeconds: PLAN_GIVE_UP_SECONDS });
  if (plan.status === null) {
    planOutcomes.add(1, { outcome: "gave_up" });
    console.warn(`면접 ${sessionId} 질문 준비 ${PLAN_GIVE_UP_SECONDS}초 넘게 끝나지 않음(마지막 응답 ${plan.lastStatus})`);
  } else if (plan.status === "READY") {
    planReady.add(plan.seconds, { flow: "plan" });
    planOutcomes.add(1, { outcome: "ready" });
  } else {
    planOutcomes.add(1, { outcome: "failed" });
    console.warn(`면접 ${sessionId} 질문 준비 실패(${plan.seconds.toFixed(0)}초)`);
  }
  check(plan.status, { "질문 준비 READY": (s) => s === "READY" });
}

/** S5: 화상 면접 한 건을 끝까지(VU마다 끝나면 다음 면접을 바로 시작해 단계 동안 동시 수를 유지한다) */
export async function video() {
  const offset = Number(__ENV.S6_VIDEO_OFFSET || 0);
  // account()는 VU 번호(1부터)로 seed/accounts.json의 계정을 고른다. 10개를 돌려 쓴다
  const me = account(((offset + exec.scenario.iterationInTest) % 10) + 1);
  const waitMs = exec.vu.iterationInScenario === 0 ? Math.random() * VIDEO_START_SPREAD_SECONDS * 1000 : 0;
  await runVideoInterviewOnce(me, { waitMs, tags: { flow: "video" }, shotPrefix: `s6-${exec.scenario.name}` });
}
