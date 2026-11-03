// S0 스모크 · 보정(HTTP)(load_test_plan 6장). 실제 외부 API로 면접 시작 전까지를 1~3건 돌린다.
// 스크립트가 맞는지 확인하고, 외부 API에 묶인 단계의 시간을 잰다(GMS 스텁 지연값의 근거, 3.4).
//   N=1 bash loadtest/run.sh scenarios/s0-smoke.js
//
// 면접 진행(질문 · 답변 · 채점)은 여기서 하지 않는다. 채팅 면접도 질문은 에이전트가 면접방(LiveKit)에서 내고,
// 에이전트는 사용자가 방에 들어올 때까지 기다린다(ai/app/agent/main.py first_participant). k6 HTTP는 방에 들어갈 수 없으므로
// 면접 진행과 채점 시간은 s0-browser.js가 잰다. 여기서는 시작한 면접을 바로 끝내(5.8, 답변 0개 → ABORTED) 에이전트를 놓아준다.
//
// 재는 것(사용자 지표, 초)
// - application_create_seconds: 지원서 저장(Jev 자소서 검증 포함)
// - plan_ready_seconds: 면접 만들기 → 질문 준비 완료(GMS PLAN)
// - start_seconds: 면접 시작(5.4: 면접방 · 에이전트 배정, 화상이면 녹화 시작)
import { check, fail, group } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";

import { account } from "../lib/accounts.js";
import { page } from "../lib/api.js";
import { login } from "../lib/auth.js";
import { requirePassword } from "../lib/config.js";
import { APPLICATIONS } from "../lib/data.js";
import { createApplication, createSession, endSession, pollSession, startSession } from "../lib/interview.js";

const N = Number(__ENV.N || 1);
const PERSONA = __ENV.PERSONA || "COFFEE_CHAT";
const MODE = __ENV.MODE || "CHAT";

const applicationCreate = new Trend("application_create_seconds");
const planReady = new Trend("plan_ready_seconds");
const start = new Trend("start_seconds");
const failed = new Counter("flow_failed");

export const options = {
  scenarios: {
    // 계정 하나가 차례로 N건(동시 부하가 아니다)
    smoke: { executor: "per-vu-iterations", vus: 1, iterations: N, maxDuration: `${N * 5}m` },
  },
  thresholds: {
    checks: ["rate==1"],
    flow_failed: ["count==0"],
    // 코드의 마감(5.1 기능 한계): 질문 준비 3분, 자소서 검증 8초
    plan_ready_seconds: ["max<180"],
    application_create_seconds: ["max<8"],
  },
};

export function setup() {
  requirePassword();
}

function stop(reason) {
  failed.add(1);
  fail(reason);
}

export default function () {
  const me = account(exec.vu.idInTest);
  const round = exec.vu.iterationInScenario + 1;
  let token;

  group("로그인 · 홈", () => {
    token = login(me.email).accessToken;
    check(page("/home", token, "FE /home"), { "FE 홈 200": (r) => r.status === 200 });
  });

  let applicationId;
  group("지원서 저장", () => {
    const created = createApplication(token, APPLICATIONS[round % APPLICATIONS.length]);
    applicationCreate.add(created.res.timings.duration / 1000);
    applicationId = created.id ?? me.applicationId;
    if (!created.id) {
      console.warn(`지원서 저장 실패(${created.res.status}), seed 지원서로 계속한다: ${created.res.body}`);
    }
  });

  let sessionId;
  group("질문 준비", () => {
    sessionId = createSession(token, applicationId, PERSONA, MODE);
    if (!sessionId) stop("면접 만들기 실패");
    const plan = pollSession(token, sessionId, (s) => s.planStatus !== "GENERATING", { timeoutSeconds: 200 });
    planReady.add(plan.seconds);
    if (plan.session?.planStatus !== "READY") stop(`질문 준비 실패: ${plan.session?.planStatus} (${plan.seconds}초)`);
    check(page(`/interview/${sessionId}`, token, "FE /interview/{id}"), { "FE 면접 화면 200": (r) => r.status === 200 });
  });

  group("시작 · 끝내기", () => {
    const begun = Date.now();
    if (!startSession(token, sessionId)) stop("면접 시작 실패");
    start.add((Date.now() - begun) / 1000);
    if (!endSession(token, sessionId)) stop("면접 끝내기 실패");
    const ended = pollSession(token, sessionId, (s) => s.status !== "IN_PROGRESS" && s.status !== "ANALYZING", {
      timeoutSeconds: 30,
    });
    check(ended.session, { "답변 없이 끝낸 면접은 ABORTED": (s) => s?.status === "ABORTED" });
  });

  group("기록 화면", () => {
    check(page("/records", token, "FE /records"), { "FE 기록 200": (r) => r.status === 200 });
  });

  console.log(`면접 ${sessionId} 확인(${round}/${N})`);
}
