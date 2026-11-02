// S0 스모크 · 보정(브라우저)(load_test_plan 6장). 실제 화면으로 화상 면접을 처음부터 끝까지 1건 진행한다.
// 가짜 카메라 · 마이크(media/answer.wav · camera.y4m)를 쓴다. answer.wav는 답변 뒤 8초 침묵이라 에이전트가 7초 침묵에서 답변을 제출한다.
//   bash loadtest/run.sh scenarios/s0-browser.js
//
// 흐름(master 화면 기준): 로그인 → /practice/interviewer?applicationId=(seed 지원서) → 면접관 → 화상 → 장치 점검(녹음 · 들어보기 · 잘 들려요)
//   → 질문 준비 완료 → 면접 시작 → 면접방(답변 5개, 마지막 답변 뒤 자동 종료) → 결과 분석 → 결과 → 다시보기
//
// 재는 것(사용자 지표, 초)
// - plan_ready_seconds: 장치 점검 화면 도착 → "면접관이 질문을 준비했어요"(GMS PLAN + 면접관 3D 모델 받기)
// - interview_seconds: 면접방 입장 → 결과 분석 화면(질문 5개 · 답변 5개)
// - evaluation_seconds: 결과 분석 화면 → 결과 화면(GMS 채점 · 결과)
// - replay_ready_seconds: 결과 화면 → 다시보기 영상 표시(녹화 합치기)
import { browser } from "k6/browser";
import { check, fail } from "k6";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";

import { account } from "../lib/accounts.js";
import { BASE_URL, PASSWORD, requirePassword } from "../lib/config.js";

const PERSONA_LABEL = { COFFEE_CHAT: "개발자 커피챗", DEVIL: "악마 면접관" }[__ENV.PERSONA || "COFFEE_CHAT"];

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

const seconds = (from) => (Date.now() - from) / 1000;

async function waitForUrl(page, pattern, timeoutSeconds) {
  const until = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < until) {
    if (pattern.test(page.url())) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

export default async function () {
  const me = account(exec.vu.idInTest);
  const context = await browser.newContext({ locale: "ko-KR" });
  await context.grantPermissions(["camera", "microphone"], { origin: BASE_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  let step = "로그인";

  try {
    await page.goto(`${BASE_URL}/login`);
    await page.locator("#email").fill(me.email);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    if (!(await waitForUrl(page, /\/home$/, 30))) fail("로그인 뒤 홈으로 가지 않았다");

    step = "면접관 · 방식 선택";
    // 지원서는 seed 것을 다시 쓴다(지원서 저장 시간은 s0-smoke.js가 잰다)
    await page.goto(`${BASE_URL}/practice/interviewer?applicationId=${me.applicationId}`);
    await page.getByText(PERSONA_LABEL, { exact: true }).click();
    await page.getByRole("button", { name: "다음: 면접 방식" }).click();
    await page.getByText("화상으로 할래요", { exact: true }).click();
    await page.getByRole("button", { name: "다음: 장치 점검" }).click();
    if (!(await waitForUrl(page, /\/practice\/devices\?sessionId=\d+/, 30))) fail("장치 점검 화면으로 가지 않았다");
    const sessionId = page.url().match(/sessionId=(\d+)/)[1];
    const atDevices = Date.now();
    console.log(`면접 ${sessionId} 만듦`);

    step = "장치 점검";
    await page.getByRole("button", { name: "녹음하기", exact: true }).click();
    await page.getByRole("button", { name: "들어보기", exact: true }).click({ timeout: 15000 });
    await page.getByRole("button", { name: "잘 들려요", exact: true }).click({ timeout: 15000 });

    step = "질문 준비";
    await page.getByText("면접관이 질문을 준비했어요").waitFor({ timeout: 200000 });
    planReady.add(seconds(atDevices));
    await page.getByRole("button", { name: "면접 시작", exact: true }).click();
    if (!(await waitForUrl(page, new RegExp(`/interview/${sessionId}$`), 30))) fail("면접방으로 가지 않았다");
    const inRoom = Date.now();

    step = "면접 진행";
    // 마지막 답변 뒤 화면이 면접을 자동으로 끝내고 결과 분석 화면을 보여 준다
    let lastSeq = 0;
    const analyzing = page.getByText("면접관이 답변을 검토하고 있어요");
    const roomUntil = Date.now() + 20 * 60 * 1000;
    while (!(await analyzing.isVisible())) {
      if (Date.now() > roomUntil) fail("20분 안에 면접이 끝나지 않았다");
      if (/\/result$/.test(page.url())) break;
      // 화면이 다시 그려지는 동안 값이 잠깐 이전 값으로 보일 수 있어, 늘어날 때만 적는다
      const seq = Number(
        await page
          .locator('[role=progressbar][aria-label="질문 진행"]')
          .first()
          .getAttribute("aria-valuenow", { timeout: 1000 })
          .catch(() => 0),
      );
      if (seq > lastSeq) {
        console.log(`질문 ${seq} (${Math.round(seconds(inRoom))}초)`);
        lastSeq = seq;
      }
      await page.waitForTimeout(2000);
    }
    interview.add(seconds(inRoom));

    step = "결과 분석";
    const analyzingFrom = Date.now();
    if (!(await waitForUrl(page, new RegExp(`/interview/${sessionId}/result$`), 660))) fail("결과 화면으로 가지 않았다");
    await page.getByText("오늘의 성장 리뷰 보기").waitFor();
    evaluation.add(seconds(analyzingFrom));

    step = "다시보기";
    const replayFrom = Date.now();
    await page.goto(`${BASE_URL}/interview/${sessionId}/replay`);
    await page.locator("video").first().waitFor({ timeout: 900000 });
    replayReady.add(seconds(replayFrom));
    check(true, { "화상 면접 끝까지 진행": (ok) => ok });
    console.log(`면접 ${sessionId} 완료: 면접 ${Math.round(seconds(inRoom))}초`);
  } catch (e) {
    failed.add(1);
    console.error(`${step} 단계 실패(${page.url()}): ${e}`);
    await page.screenshot({ path: `results/s0-browser-${step}.png`, fullPage: true }).catch(() => {});
    check(false, { "화상 면접 끝까지 진행": (ok) => ok });
  } finally {
    await page.close();
    await context.close();
  }
}
