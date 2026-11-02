// S1 웹 · API 혼합(load_test_plan 6장, 가설 H4 · H5). 면접 없이 화면을 둘러보는 요청만 초당 수를 정해 올린다.
//   bash loadtest/run.sh scenarios/s1-web-mix.js                          # 5 → 30 → 60 req/s, 단계마다 10분
//   RATES=5,30 HOLD=2m RAMP=30s bash loadtest/run.sh scenarios/s1-web-mix.js  # 짧게 확인
//
// - 화면 · 비율 · 계정은 lib/web-mix.js(S2 배경 부하와 같이 쓴다). VU마다 처음에 한 번 로그인한다(로그인 몰림은 S2)
// - ramping-arrival-rate라 응답이 느려져도 보내는 양이 줄지 않는다. 단계(stage 태그)마다 p95 · 실패율을 따로 본다
//
// 한계 판정(5.1): 페이지 p95 ≥ 1.5초 → 품질 한계, 실패율 ≥ 1% → 기능 한계. 서버 쪽은 같은 구간을 resources.sh · Grafana로 본다
import exec from "k6/execution";

import { requirePassword } from "../lib/config.js";
import { PAGES, browse } from "../lib/web-mix.js";

const RATES = (__ENV.RATES || "5,30,60").split(",").map(Number);
const HOLD = __ENV.HOLD || "10m";
const RAMP = __ENV.RAMP || "1m";

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

export function setup() {
  requirePassword();
}

export default function () {
  browse({ stage: stageTag() });
}
