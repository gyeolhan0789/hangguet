// S5 동시 화상 면접(load_test_plan 6장, 가설 H6 · H7 · H8 · H9). 계정마다 실제 화면으로 화상 면접 1건씩을 거의 동시에 진행한다.
// 단계(동시 1 · 3 · 5 …)는 s5-levels.sh가 차례로 돌린다. 한 단계만:
//   N=3 bash loadtest/run.sh scenarios/s5-interview-browser.js
// - N: 동시 면접 수(계정 N개가 필요하다, seed.js COUNT). STAGGER: 면접마다 시작을 몇 초씩 벌린다(기본 3초, 6장 "시작 시각 몇 초씩 분산")
// - START_AT: 노트북 여러 대가 같이 돌릴 때 맞출 시작 시각(유닉스 초). ACCOUNT_OFFSET으로 노트북마다 다른 계정을 쓴다(노트북 A 0, B 10 …)
// - 외부 API는 실제 API를 쓴다(GMS 스텁 주소를 넣은 서버면 스텁)
//
// 재는 것 · 실패 구분은 lib/video-interview-run.js(level 태그 = N). 한계 판정(5.1): 면접 · 다시보기 실패 모두 기능 한계.
// 서버 CPU는 server/resources.sh로 본다
import exec from "k6/execution";

import { account } from "../lib/accounts.js";
import { requirePassword } from "../lib/config.js";
import { runVideoInterviewOnce } from "../lib/video-interview-run.js";

const N = Number(__ENV.N || 1);
const STAGGER = Number(__ENV.STAGGER || 3);
const START_AT = Number(__ENV.START_AT || 0);
const TAGS = { level: String(N) };

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

export default async function ({ startAt }) {
  const vu = exec.vu.idInTest;
  // 면접마다 시작을 STAGGER초씩 벌린다(모두 같은 순간에 누르는 것보다 실제에 가깝고, 장치 점검 녹음이 겹치지 않는다)
  const waitMs = startAt * 1000 + (vu - 1) * STAGGER * 1000 - Date.now();
  await runVideoInterviewOnce(account(vu), { waitMs, tags: TAGS, shotPrefix: `s5-N${N}`, persona: __ENV.PERSONA });
}
