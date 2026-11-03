// S0 스모크 · 보정(브라우저)(load_test_plan 6장). 실제 화면으로 화상 면접을 처음부터 끝까지 1건 진행한다.
// 가짜 카메라 · 마이크(media/answer.wav · camera.y4m)를 쓴다. 흐름은 lib/browser-interview.js
//   bash loadtest/run.sh scenarios/s0-browser.js
//
// 재는 것(사용자 지표, 초): plan_ready_seconds · interview_seconds · evaluation_seconds · replay_ready_seconds(뜻은 lib/browser-interview.js)
import { browser } from "k6/browser";
import { check } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";

import { account } from "../lib/accounts.js";
import { loginByUi, runVideoInterview } from "../lib/browser-interview.js";
import { BASE_URL, requirePassword } from "../lib/config.js";

const planReady = new Trend("plan_ready_seconds");
const interview = new Trend("interview_seconds");
const evaluation = new Trend("evaluation_seconds");
const replayReady = new Trend("replay_ready_seconds");
const failed = new Counter("flow_failed");

export const options = {
  scenarios: {
    ui: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "30m",
      options: { browser: { type: "chromium" } },
    },
  },
  thresholds: {
    checks: ["rate==1"],
    flow_failed: ["count==0"],
    // 코드의 마감(5.1 기능 한계): 질문 준비 3분, 결과 10분, 녹화 합치기 15분
    plan_ready_seconds: ["max<180"],
    evaluation_seconds: ["max<600"],
    replay_ready_seconds: ["max<900"],
  },
};

export function setup() {
  requirePassword();
}

export default async function () {
  const me = account(exec.vu.idInTest);
  const context = await browser.newContext({ locale: "ko-KR" });
  await context.grantPermissions(["camera", "microphone"], { origin: BASE_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  try {
    await loginByUi(page, me.email);
    const r = await runVideoInterview(page, me.applicationId, { persona: __ENV.PERSONA, log: console.log });
    planReady.add(r.planReadySeconds);
    interview.add(r.interviewSeconds);
    evaluation.add(r.evaluationSeconds);
    replayReady.add(r.replaySeconds);
    check(true, { "화상 면접 끝까지 진행": (ok) => ok });
    console.log(`면접 ${r.sessionId} 완료: 면접 ${Math.round(r.interviewSeconds)}초`);
  } catch (e) {
    failed.add(1);
    console.error(`${e.step ?? ""} 단계 실패(${page.url()}): ${e.message}`);
    await page.screenshot({ path: `results/s0-browser-${e.step ?? "error"}.png`, fullPage: true }).catch(() => {});
    check(false, { "화상 면접 끝까지 진행": (ok) => ok });
  } finally {
    await page.close();
    await context.close();
  }
}
