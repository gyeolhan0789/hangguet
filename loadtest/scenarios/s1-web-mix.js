// S1 웹 · API 혼합(load_test_plan 6장, 가설 H4 · H5). 면접 없이 화면을 둘러보는 요청만 초당 수를 정해 올린다.
//   bash loadtest/run.sh scenarios/s1-web-mix.js                          # 5 → 30 → 60 req/s, 단계마다 10분
//   RATES=5,30 HOLD=2m RAMP=30s bash loadtest/run.sh scenarios/s1-web-mix.js  # 짧게 확인
//
// - 화면은 실제처럼 FE 페이지로 보낸다(hk_access 쿠키). 70%는 화면 이동과 같은 RSC 요청(RSC: 1), 30%는 전체 HTML
//   모든 화면은 레이아웃에서 내 정보 · 공지를 부르므로 화면 하나가 BE 호출 3~6개가 된다
// - 비율: 홈 25 · 기록 20 · 결과 20 · 마이페이지 15 · 성장 리뷰 10 · 다시보기 10(%)
// - 계정: seed/accounts.json의 앞 ACCOUNTS개(끝낸 면접이 있는 계정)를 VU끼리 돌려 쓴다. VU마다 처음에 한 번 로그인한다(로그인 몰림은 S2)
// - ramping-arrival-rate라 응답이 느려져도 보내는 양이 줄지 않는다. 단계(stage 태그)마다 p95 · 실패율을 따로 본다
//
// 한계 판정(5.1): 페이지 p95 ≥ 1.5초 → 품질 한계, 실패율 ≥ 1% → 기능 한계. 서버 쪽은 같은 구간을 resources.sh · Grafana로 본다
import { check } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

import { accountCycled } from "../lib/accounts.js";
import { apiGet, page } from "../lib/api.js";
import { login } from "../lib/auth.js";
import { requirePassword } from "../lib/config.js";

const RATES = (__ENV.RATES || "5,30,60").split(",").map(Number);
const HOLD = __ENV.HOLD || "10m";
const RAMP = __ENV.RAMP || "1m";
const ACCOUNTS = Number(__ENV.ACCOUNTS || 4);
const RSC_RATIO = 0.7;

const PAGES = [
  { name: "FE /home", weight: 25, path: () => "/home" },
  { name: "FE /records", weight: 20, path: (d) => `/records?date=${d.date}` },
  { name: "FE /interview/:id/result", weight: 20, path: (d) => `/interview/${d.sessionId}/result` },
  { name: "FE /mypage", weight: 15, path: () => "/mypage" },
  { name: "FE /reviews/:date", weight: 10, path: (d) => `/reviews/${d.date}` },
  { name: "FE /interview/:id/replay", weight: 10, path: (d) => `/interview/${d.sessionId}/replay` },
];
const TOTAL_WEIGHT = PAGES.reduce((s, p) => s + p.weight, 0);

function seconds(duration) {
  const m = /^(\d+)(s|m)$/.exec(duration);
  if (!m) throw new Error(`시간은 30s · 10m 꼴이다: ${duration}`);
  return Number(m[1]) * (m[2] === "m" ? 60 : 1);
}

// 단계: 단계마다 RAMP 동안 올리고 HOLD 동안 유지한다. 유지 구간만 stage 태그(예: 30rps)로 묶는다
const stages = [];
const segments = [];
let elapsed = 0;
for (const rate of RATES) {
  stages.push({ target: rate, duration: RAMP }, { target: rate, duration: HOLD });
  elapsed += seconds(RAMP);
  segments.push({ until: elapsed, tag: "ramp" });
  elapsed += seconds(HOLD);
  segments.push({ until: elapsed, tag: `${rate}rps` });
}

function stageTag() {
  const t = (Date.now() - exec.scenario.startTime) / 1000;
  return (segments.find((s) => t < s.until) || segments[segments.length - 1]).tag;
}

const thresholds = {
  // 안전장치: 실패율 5%가 1분 넘게 이어지면 멈춘다(그 위는 실패만 늘어난다, 3.5)
  http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "1m" }],
};
for (const rate of RATES) {
  thresholds[`http_req_duration{type:page,stage:${rate}rps}`] = ["p(95)<1500"];
  thresholds[`http_req_failed{type:page,stage:${rate}rps}`] = ["rate<0.01"];
}
for (const p of PAGES) {
  thresholds[`http_req_duration{name:${p.name}}`] = ["p(95)<1500"];
}

export const options = {
  scenarios: {
    web: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: Number(__ENV.VUS || 20),
      maxVUs: Number(__ENV.MAX_VUS || 300),
      stages,
    },
  },
  thresholds,
};

const relogins = new Counter("relogins");

export function setup() {
  requirePassword();
}

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

export default function () {
  if (!state) {
    state = prepare(accountCycled(exec.vu.idInTest, ACCOUNTS));
  }
  const target = pickPage();
  const data = state.done[Math.floor(Math.random() * state.done.length)];
  const path = target.path(data);
  const rsc = Math.random() < RSC_RATIO;
  const tags = { stage: stageTag(), rsc: String(rsc) };

  let res = page(path, state.token, target.name, { rsc, tags });
  if ((res.status === 307 || res.status === 302) && (res.headers.Location || "").includes("/login")) {
    // 액세스 토큰이 끝나 로그인 화면으로 보냈다. 다시 로그인하고 한 번만 다시 보낸다
    relogins.add(1);
    state.token = login(state.me.email).accessToken;
    res = page(path, state.token, target.name, { rsc, tags });
  }
  check(res, { "화면 200": (r) => r.status === 200 });
}
