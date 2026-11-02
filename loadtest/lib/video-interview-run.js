// 화상 면접 1건을 실제 화면으로 진행하고 사용자 지표를 남긴다(S5 · S6). 흐름은 lib/browser-interview.js.
// 재는 것(초): plan_ready · first_question · question_gap · interview · evaluation · replay_ready
// 실패는 둘로 나눠 센다: interview_failed(면접관 입장 · 진행 · 결과 실패), replay_failed(면접은 끝났지만 다시보기 녹화 실패).
// 실패해도 그 단계 전까지 잰 값은 남긴다. 시나리오 태그(S6 stage 등)는 k6가 지표에 붙인다
import { browser } from "k6/browser";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

import { loginByUi, runVideoInterview } from "./browser-interview.js";
import { BASE_URL } from "./config.js";

export const planReady = new Trend("plan_ready_seconds");
const firstQuestion = new Trend("first_question_seconds");
const questionGap = new Trend("question_gap_seconds");
const interview = new Trend("interview_seconds");
const evaluation = new Trend("evaluation_seconds");
const replayReady = new Trend("replay_ready_seconds");
const completed = new Counter("interview_completed");
const failed = new Counter("interview_failed");
const replayFailed = new Counter("replay_failed");

/** 잰 값만 기록한다(실패한 면접은 일부만 있다) */
function record(t, tags) {
  if (t.planReadySeconds !== undefined) planReady.add(t.planReadySeconds, tags);
  if (t.firstQuestionSeconds !== null && t.firstQuestionSeconds !== undefined) firstQuestion.add(t.firstQuestionSeconds, tags);
  for (const gap of t.questionGaps || []) questionGap.add(gap, tags);
  if (t.interviewSeconds !== undefined) interview.add(t.interviewSeconds, tags);
  if (t.evaluationSeconds !== undefined) evaluation.add(t.evaluationSeconds, tags);
  if (t.replaySeconds !== undefined) replayReady.add(t.replaySeconds, tags);
}

function summary(t) {
  const gaps = (t.questionGaps || []).map((g) => g.toFixed(0)).join("/");
  return `첫 질문 ${t.firstQuestionSeconds?.toFixed(1) ?? "-"}초, 질문 간격 ${gaps || "-"}초, 결과 ${t.evaluationSeconds?.toFixed(1) ?? "-"}초`;
}

/**
 * 계정 me({ index, email, applicationId })로 화상 면접 1건을 끝까지 진행한다.
 * - waitMs: 시작 전에 기다릴 시간(동시 면접 시작을 벌릴 때)
 * - tags: 지표에 붙일 태그(S5 level)
 * - shotPrefix: 실패 화면 캡처 파일 앞부분(results/<shotPrefix>-<계정>-<단계>.png)
 */
export async function runVideoInterviewOnce(me, { waitMs = 0, tags = {}, shotPrefix = "video", persona } = {}) {
  const context = await browser.newContext({ locale: "ko-KR" });
  await context.grantPermissions(["camera", "microphone"], { origin: BASE_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  try {
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    await loginByUi(page, me.email);
    const r = await runVideoInterview(page, me.applicationId, { persona, log: console.log });
    record(r, tags);
    completed.add(1, tags);
    check(true, { "면접 · 다시보기 끝까지": (ok) => ok });
    console.log(`계정 ${me.index} 면접 ${r.sessionId} 완료: ${summary(r)}`);
  } catch (e) {
    if (e.timings) record(e.timings, tags);
    if (e.step === "다시보기") {
      // 면접은 끝났고 녹화만 실패했다
      replayFailed.add(1, tags);
      completed.add(1, tags);
    } else {
      failed.add(1, { ...tags, step: e.step ?? "기타" });
    }
    console.error(`계정 ${me.index} 면접 ${e.sessionId ?? "-"} ${e.step ?? ""} 단계 실패(${page.url()}): ${e.message} [${summary(e.timings || {})}]`);
    await page.screenshot({ path: `results/${shotPrefix}-${me.index}-${e.step ?? "error"}.png`, fullPage: true }).catch(() => {});
    check(false, { "면접 · 다시보기 끝까지": (ok) => ok });
  } finally {
    await page.close();
    await context.close();
  }
}
