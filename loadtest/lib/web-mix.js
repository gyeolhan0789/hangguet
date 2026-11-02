// 화면 둘러보기 요청 하나(S1 웹 · API 혼합, load_test_plan 6장). S1 본 부하와 S2의 배경 부하(S1 L1)가 같이 쓴다.
// - 화면은 실제처럼 FE 페이지로 보낸다(hk_access 쿠키). 70%는 화면 이동과 같은 RSC 요청(RSC: 1), 30%는 전체 HTML
//   모든 화면은 레이아웃에서 내 정보 · 공지를 부르므로 화면 하나가 BE 호출 3~6개가 된다
// - 비율: 홈 25 · 기록 20 · 결과 20 · 마이페이지 15 · 성장 리뷰 10 · 다시보기 10(%)
// - 계정: seed/accounts.json의 앞 ACCOUNTS개(끝낸 면접이 있는 계정)를 VU끼리 돌려 쓴다. VU마다 처음에 한 번 로그인한다
import { check } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

import { accountCycled } from "./accounts.js";
import { apiGet, page } from "./api.js";
import { login } from "./auth.js";

const ACCOUNTS = Number(__ENV.ACCOUNTS || 4);
const RSC_RATIO = 0.7;

export const PAGES = [
  { name: "FE /home", weight: 25, path: () => "/home" },
  { name: "FE /records", weight: 20, path: (d) => `/records?date=${d.date}` },
  { name: "FE /interview/:id/result", weight: 20, path: (d) => `/interview/${d.sessionId}/result` },
  { name: "FE /mypage", weight: 15, path: () => "/mypage" },
  { name: "FE /reviews/:date", weight: 10, path: (d) => `/reviews/${d.date}` },
  { name: "FE /interview/:id/replay", weight: 10, path: (d) => `/interview/${d.sessionId}/replay` },
];
const TOTAL_WEIGHT = PAGES.reduce((s, p) => s + p.weight, 0);

const relogins = new Counter("relogins");

function koreaToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** VU마다 처음 한 번: 로그인하고, 이번 달 끝낸 면접(결과 · 다시보기 · 성장 리뷰에 쓸 id와 날짜)을 찾는다 */
function prepare(me) {
  const token = login(me.email).accessToken;
  const month = koreaToday().slice(0, 7);
  const calendar = apiGet(`/interview-sessions/calendar?month=${month}`, token, "5.15 GET /interview-sessions/calendar");
  const dates = (calendar.json("content") || []).filter((d) => d.interviewCount > 0).map((d) => d.practiceDate);
  const done = [];
  for (const date of dates) {
    const list = apiGet(`/interview-sessions?practiceDate=${date}&size=20`, token, "5.13 GET /interview-sessions");
    for (const s of list.json("content") || []) {
      if (s.status === "COMPLETED") done.push({ sessionId: s.id, date });
    }
  }
  if (done.length === 0) {
    throw new Error(`계정 ${me.index}에 끝낸 면접이 없다(seed/interviews-browser.js로 만든다)`);
  }
  return { me, token, done };
}

let state = null;

function pickPage() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const p of PAGES) {
    if ((r -= p.weight) < 0) return p;
  }
  return PAGES[0];
}

/** 화면 하나를 연다. tags는 요청에 붙일 태그(예: stage) */
export function browse(tags = {}) {
  if (!state) {
    state = prepare(accountCycled(exec.vu.idInTest, ACCOUNTS));
  }
  const target = pickPage();
  const data = state.done[Math.floor(Math.random() * state.done.length)];
  const path = target.path(data);
  const rsc = Math.random() < RSC_RATIO;
  const allTags = { ...tags, rsc: String(rsc) };

  let res = page(path, state.token, target.name, { rsc, tags: allTags });
  if ((res.status === 307 || res.status === 302) && (res.headers.Location || "").includes("/login")) {
    // 액세스 토큰이 끝나 로그인 화면으로 보냈다. 다시 로그인하고 한 번만 다시 보낸다
    relogins.add(1);
    state.token = login(state.me.email).accessToken;
    res = page(path, state.token, target.name, { rsc, tags: allTags });
  }
  check(res, { "화면 200": (r) => r.status === 200 });
}
