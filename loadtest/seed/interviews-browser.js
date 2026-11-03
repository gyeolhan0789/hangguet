// 계정마다 끝낸 화상 면접을 만든다(S1 · S2의 기록 · 결과 · 다시보기 화면이 실제 데이터를 그리도록, load_test_plan 3.6).
// 끝낸 면접은 실제 화면으로만 만들 수 있다(에이전트가 면접방 입장을 기다린다, 6장 시나리오별 주의). 면접 1건 약 2.5분.
//   COUNT=3 PER_ACCOUNT=3 ACCOUNT_OFFSET=1 bash loadtest/run.sh seed/interviews-browser.js
// - COUNT: 계정 수(동시에 진행한다). ACCOUNT_OFFSET: seed/accounts.json에서 건너뛸 계정 수
// - PER_ACCOUNT: 계정마다 차례로 진행할 면접 수
// 실제 외부 API를 쓴다(GMS 스텁 주소를 넣은 서버면 스텁).
import { browser } from "k6/browser";
import { check } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

import { account } from "../lib/accounts.js";
import { loginByUi, runVideoInterview } from "../lib/browser-interview.js";
import { BASE_URL, requirePassword } from "../lib/config.js";

const COUNT = Number(__ENV.COUNT || 1);
const PER_ACCOUNT = Number(__ENV.PER_ACCOUNT || 3);
const failed = new Counter("flow_failed");

export const options = {
  scenarios: {
    seed: {
      executor: "per-vu-iterations",
      vus: COUNT,
      iterations: PER_ACCOUNT,
      maxDuration: `${PER_ACCOUNT * 10 + 10}m`,
      options: { browser: { type: "chromium" } },
    },
  },
  thresholds: { flow_failed: ["count==0"] },
};

export function setup() {
  requirePassword();
}

export default async function () {
  const me = account(exec.vu.idInTest);
  const round = exec.vu.iterationInScenario + 1;
  const context = await browser.newContext({ locale: "ko-KR" });
  await context.grantPermissions(["camera", "microphone"], { origin: BASE_URL });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  try {
    await loginByUi(page, me.email);
    const r = await runVideoInterview(page, me.applicationId);
    check(true, { "면접 끝까지 진행": (ok) => ok });
    console.log(`계정 ${me.index} 면접 ${r.sessionId} 완료(${round}/${PER_ACCOUNT})`);
  } catch (e) {
    failed.add(1);
    console.error(`계정 ${me.index} ${e.step ?? ""} 단계 실패(${page.url()}): ${e.message}`);
    await page.screenshot({ path: `results/seed-${me.index}-${e.step ?? "error"}.png`, fullPage: true }).catch(() => {});
    check(false, { "면접 끝까지 진행": (ok) => ok });
  } finally {
    await page.close();
    await context.close();
  }
}
