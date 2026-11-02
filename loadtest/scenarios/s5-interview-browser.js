// S5 동시 화상 면접(load_test_plan 6장, 가설 H6 · H7 · H8 · H9). 계정마다 실제 화면으로 화상 면접 1건씩을 거의 동시에 진행한다.
// 단계(동시 1 · 3 · 5 …)는 s5-levels.sh가 차례로 돌린다. 한 단계만:
//   N=3 bash loadtest/run.sh scenarios/s5-interview-browser.js
// - N: 동시 면접 수(계정 N개가 필요하다, seed.js COUNT). STAGGER: 면접마다 시작을 몇 초씩 벌린다(기본 3초, 6장 "시작 시각 몇 초씩 분산")
// - START_AT: 노트북 여러 대가 같이 돌릴 때 맞출 시작 시각(유닉스 초). ACCOUNT_OFFSET으로 노트북마다 다른 계정을 쓴다(노트북 A 0, B 10 …)
// - 외부 API는 실제 API를 쓴다(GMS 스텁 주소를 넣은 서버면 스텁)
//
// 재는 것(사용자 지표, 초, level 태그 = N): plan_ready · first_question · question_gap · interview · evaluation · replay_ready(lib/browser-interview.js)
// 실패는 둘로 나눠 센다: interview_failed(면접관 입장 · 진행 · 결과 실패), replay_failed(면접은 끝났지만 다시보기 녹화 실패).
// 실패해도 그 단계 전까지 잰 값은 남긴다. 한계 판정(5.1): 둘 다 기능 한계. 서버 CPU는 server/resources.sh로 본다
import { browser } from "k6/browser";
import { check } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";

import { account } from "../lib/accounts.js";
import { loginByUi, runVideoInterview } from "../lib/browser-interview.js";
import { BASE_URL, requirePassword } from "../lib/config.js";

const N = Number(__ENV.N || 1);
const STAGGER = Number(__ENV.STAGGER || 3);
const START_AT = Number(__ENV.START_AT || 0);
const TAGS = { level: String(N) };

const planReady = new Trend("plan_ready_seconds");
const firstQuestion = new Trend("first_question_seconds");
const questionGap = new Trend("question_gap_seconds");
const interview = new Trend("interview_seconds");
const evaluation = new Trend("evaluation_seconds");
const replayReady = new Trend("replay_ready_seconds");
const completed = new Counter("interview_completed");
const failed = new Counter("interview_failed");
const replayFailed = new Counter("replay_failed");

export const options = {
  scenarios: {
    interviews: {
      executor: "per-vu-iterations",
      vus: N,
      iterations: 1,
      maxDuration: "40m",
      options: { browser: { type: "chromium" } },
    },
  },
  thresholds: {
    interview_failed: ["count==0"],
    replay_failed: ["count==0"],
    // 코드의 마감(5.1 기능 한계): 질문 준비 3분, 결과 10분, 녹화 합치기 15분. 첫 질문은 2분(lib/browser-interview.js)
    plan_ready_seconds: ["max<180"],
    first_question_seconds: ["max<120"],
    question_gap_seconds: ["p(95)<40"],
    evaluation_seconds: ["max<600"],
    replay_ready_seconds: ["max<900"],
  },
};

export function setup() {
  requirePassword();
  const startAt = START_AT || Math.ceil(Date.now() / 1000) + 5;
  console.log(`동시 ${N}건, ${new Date(startAt * 1000).toISOString()}부터 ${STAGGER}초 간격으로 시작`);
  return { startAt };
}

/** 잰 값만 기록한다(실패한 면접은 일부만 있다) */
function record(t) {
  if (t.planReadySeconds !== undefined) planReady.add(t.planReadySeconds, TAGS);
  if (t.firstQuestionSeconds !== null && t.firstQuestionSeconds !== undefined) firstQuestion.add(t.firstQuestionSeconds, TAGS);
  for (const gap of t.questionGaps || []) questionGap.add(gap, TAGS);
  if (t.interviewSeconds !== undefined) interview.add(t.interviewSeconds, TAGS);
  if (t.evaluationSeconds !== undefined) evaluation.add(t.evaluationSeconds, TAGS);
  if (t.replaySeconds !== undefined) replayReady.add(t.replaySeconds, TAGS);
}

function summary(t) {
  const gaps = (t.questionGaps || []).map((g) => g.toFixed(0)).join("/");
  return `첫 질문 ${t.firstQuestionSeconds?.toFixed(1) ?? "-"}초, 질문 간격 ${gaps || "-"}초, 결과 ${t.evaluationSeconds?.toFixed(1) ?? "-"}초`;
}

export default async function ({ startAt }) {
  const vu = exec.vu.idInTest;
  const me = account(vu);
  // 면접마다 시작을 STAGGER초씩 벌린다(모두 같은 순간에 누르는 것보다 실제에 가깝고, 장치 점검 녹음이 겹치지 않는다)
  const wait = startAt * 1000 + (vu - 1) * STAGGER * 1000 - Date.now();
  const context = await browser.newContext({ locale: "ko-KR" });
  await context.grantPermissions(["camera", "microphone"], { origin: BASE_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  try {
    if (wait > 0) await page.waitForTimeout(wait);
    await loginByUi(page, me.email);
    const r = await runVideoInterview(page, me.applicationId, { persona: __ENV.PERSONA, log: console.log });
    record(r);
    completed.add(1, TAGS);
    check(true, { "면접 · 다시보기 끝까지": (ok) => ok });
    console.log(`계정 ${me.index} 면접 ${r.sessionId} 완료: ${summary(r)}`);
  } catch (e) {
    if (e.timings) record(e.timings);
    if (e.step === "다시보기") {
      // 면접은 끝났고 녹화만 실패했다
      replayFailed.add(1, TAGS);
      completed.add(1, TAGS);
    } else {
      failed.add(1, { ...TAGS, step: e.step ?? "기타" });
    }
    console.error(`계정 ${me.index} 면접 ${e.sessionId ?? "-"} ${e.step ?? ""} 단계 실패(${page.url()}): ${e.message} [${summary(e.timings || {})}]`);
    await page.screenshot({ path: `results/s5-N${N}-${me.index}-${e.step ?? "error"}.png`, fullPage: true }).catch(() => {});
    check(false, { "면접 · 다시보기 끝까지": (ok) => ok });
  } finally {
    await page.close();
    await context.close();
  }
}
