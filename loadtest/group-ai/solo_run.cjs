// 개인 화상 면접을 실제 화면으로 SOLOS건 동시에 끝까지 진행한다. 그룹 면접 에이전트 부하와 비교할 기준이다
// (report/group-ai-2026-11-15.md). 결과는 OUT/solo-<시각>-n<건수>.json. 실행 방법은 group_run.cjs와 같다(-e SOLOS=1).
// 마이크는 media/u1.wav, 면접관은 그룹 측정과 같은 개발자 커피챗이다.
const fs = require("fs");
const net = require("net");
const { chromium } = require("playwright");

const API = process.env.API || "http://g529-be:8080/api/v1";
const FE = "http://localhost:13000";
const SOLOS = Number(process.env.SOLOS || 1);
const MEDIA = process.env.MEDIA || "/w/group-ai/media";
// 마이크 파일 이름 뒤에 붙는 값. -long이면 긴 답변(make-media.ps1 -Long)을 사용한다
const VOICE = process.env.VOICE || "";
const CAMERA = process.env.CAMERA || "/w/group-ai/media/camera.y4m";
const OUT = process.env.OUT || "/w/results/group-ai";
const PASSWORD = "Passw0rd-load";
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

net.createServer((c) => {
  const u = net.connect(13000, "host.docker.internal");
  c.pipe(u).pipe(c);
  c.on("error", () => u.destroy());
  u.on("error", () => c.destroy());
}).listen(13000, "127.0.0.1");

async function api(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const COVER = [
  { question: "지원 동기", answer: "사용자가 매일 쓰는 서비스를 안정적으로 운영하는 일에 관심이 많습니다. 동아리에서 예약 서비스를 만들며 접속이 몰리는 시간에 응답이 느려지는 문제를 겪었고, 쿼리 실행 계획을 읽어 인덱스를 추가해 응답 시간을 절반으로 줄였습니다." },
  { question: "협업 경험", answer: "네 명이 함께한 프로젝트에서 API 명세를 먼저 정하고 목 서버를 만들어 프론트엔드와 병렬로 개발했습니다. 변경이 생기면 명세 문서부터 고쳐 통합 단계에서 큰 충돌 없이 배포했습니다." },
];

async function runSolo(n) {
  const tag = `s${n}-${Date.now() % 100000}`;
  const r = { tag };
  const email = `load-${tag}@test.local`;
  const s = await api("POST", "/auth/signup", {
    email, password: PASSWORD, nickname: tag,
    agreements: ["TERMS", "PRIVACY", "RECORDING"].map((termsType) => ({ termsType, termsVersion: "1.0" })),
  });
  if (s.status !== 201) throw new Error(`가입 ${s.status} ${s.text}`);
  const a = await api("POST", "/applications", { companyName: "한끗테크", jobTitle: "백엔드 개발자", coverLetterItems: COVER }, s.json.accessToken);
  if (a.status !== 201) throw new Error(`지원서 ${a.status} ${a.text}`);

  const b = await chromium.launch({
    args: [
      "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${CAMERA}`, `--use-file-for-fake-audio-capture=${MEDIA}/u1${VOICE}.wav`,
      `--unsafely-treat-insecure-origin-as-secure=${FE}`, "--autoplay-policy=no-user-gesture-required",
      "--disable-3d-apis", "--disable-webgl",
    ],
  });
  const ctx = await b.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(`${FE}/login`, { waitUntil: "networkidle", timeout: 180000 });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL(/\/home$/, { timeout: 90000 });

  await page.goto(`${FE}/practice/interviewer?applicationId=${a.json.id}`);
  await page.getByText("개발자 커피챗", { exact: true }).click();
  await page.getByRole("button", { name: "다음: 면접 방식" }).click();
  await page.getByText("화상으로 할래요", { exact: true }).click();
  await page.getByRole("button", { name: "다음: 장치 점검" }).click();
  await page.waitForURL(/\/practice\/devices\?sessionId=\d+/);
  r.sessionId = Number(page.url().match(/sessionId=(\d+)/)[1]);
  await page.getByRole("button", { name: "녹음하기", exact: true }).click();
  await page.getByRole("button", { name: "들어보기", exact: true }).click({ timeout: 20000 });
  await page.getByRole("button", { name: "잘 들려요", exact: true }).click({ timeout: 20000 });
  await page.getByText("면접관이 질문을 준비했어요").waitFor({ timeout: 300000 });
  await page.getByRole("button", { name: "면접 시작", exact: true }).click();
  r.startClickedAt = Date.now();
  await page.waitForURL(new RegExp(`/interview/${r.sessionId}$`));
  log(tag, "면접방 입장", r.sessionId);
  const analyzing = page.getByText("면접관이 답변을 검토하고 있어요");
  while (!(await analyzing.isVisible().catch(() => false)) && !/\/result$/.test(page.url())) {
    if (Date.now() - r.startClickedAt > 25 * 60 * 1000) throw new Error("25분 안에 면접이 끝나지 않았다");
    await sleep(1000);
  }
  r.ended = Date.now();
  log(tag, "면접 끝", Math.round((r.ended - r.startClickedAt) / 1000), "초");
  await b.close();
  return r;
}

(async () => {
  const results = await Promise.all(Array.from({ length: SOLOS }, (_, i) => runSolo(i + 1).catch((e) => ({ error: e.message }))));
  const file = `${OUT}/solo-${new Date(t0).toISOString().replace(/[:.]/g, "-")}-n${SOLOS}.json`;
  fs.writeFileSync(file, JSON.stringify({ startedAt: t0, solos: SOLOS, results }, null, 1));
  log("저장", file);
  process.exit(results.some((x) => x.error) ? 1 : 0);
})();
