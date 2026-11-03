// 질문 준비(PLAN)가 끝날 때까지 화면처럼 기다린다(S4 · S6).
// 장치 점검 화면(plan-progress.tsx)은 planStatus가 GENERATING인 동안 2초마다 router.refresh()로 같은 페이지를 다시 그린다.
// 그래서 /practice/devices?sessionId=…를 처음엔 전체 HTML, 그 뒤 2초마다 RSC로 GET하고, 응답의 planStatus를 읽는다.
import { sleep } from "k6";

import { page } from "./api.js";

export const PLAN_PAGE = "FE /practice/devices";
const POLL_SECONDS = 2; // plan-progress.tsx PLAN_POLL_MS

/** 화면 응답에서 질문 준비 상태(planStatus)를 읽는다. 면접 상태(status)도 READY라서 planStatus만 본다 */
export function planStatusOf(body) {
  const m = /\\?"planStatus\\?":\\?"(GENERATING|READY|FAILED)/.exec(body || "");
  return m ? m[1] : null;
}

/**
 * 질문 준비가 끝날 때까지 기다린다. giveUpSeconds가 지나도 GENERATING이면 status null(포기).
 * 돌려주는 값: { status: "READY" | "FAILED" | null, seconds, polls, lastStatus(마지막 HTTP 상태) }
 */
export function waitPlanReady(token, sessionId, { giveUpSeconds = 240, tags = {} } = {}) {
  const path = `/practice/devices?sessionId=${sessionId}`;
  const started = Date.now();
  let polls = 0;
  let res = page(path, token, PLAN_PAGE, { rsc: false, tags });
  let status = planStatusOf(res.body);
  while (status === "GENERATING" || status === null) {
    if ((Date.now() - started) / 1000 > giveUpSeconds) {
      return { status: null, seconds: (Date.now() - started) / 1000, polls, lastStatus: res.status };
    }
    sleep(POLL_SECONDS);
    res = page(path, token, PLAN_PAGE, { rsc: true, tags });
    polls++;
    status = planStatusOf(res.body);
  }
  return { status, seconds: (Date.now() - started) / 1000, polls, lastStatus: res.status };
}
