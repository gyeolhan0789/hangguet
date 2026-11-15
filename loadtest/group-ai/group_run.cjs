// 그룹 화상 면접(3명)을 실제 화면으로 GROUPS개 동시에 끝까지 진행하고, 면접방 단계 · 질문 시각과 다시보기 구간을 기록한다
// (report/group-ai-2026-11-15.md). 결과는 OUT/run-<시각>-g<그룹 수>.json이고, 그룹마다 면접 기록을 <태그>-interview.json으로 먼저 저장한다.
//
// Playwright 컨테이너 안에서 실행한다(BE · LiveKit과 같은 Docker 네트워크, 화면은 내 PC의 next start).
//   docker run --rm --network <망> -v "<레포>/loadtest:/w" -v "<frontend/node_modules>:/nm:ro" -e NODE_PATH=/nm \
//     -e API=http://<BE>:8080/api/v1 -e GROUPS=1 mcr.microsoft.com/playwright:v1.64.1-noble node /w/group-ai/group_run.cjs
//
// - 마이크는 media/u1~u3.wav(make-media.ps1, 참가자마다 주제가 다른 답변)이고 Chromium이 반복 재생한다.
//   차례가 아닌 참가자도 계속 발화하므로, 답변자 전사에 다른 참가자의 낱말이 섞이는지 확인할 수 있다.
// - 화면 3D(WebGL)는 비활성화한다. 활성화하면 브라우저 1개가 CPU를 약 9코어 사용해 측정 대상(에이전트)과 CPU를 경쟁하기 때문이다(run.sh 34줄).
// - 면접방 정보(단계 · 차례)와 질문 메시지는 세 참가자 화면 모두에서 JSON.parse를 가로채 기록한다.
//   LiveKit RPC 본문은 압축되어 바이트로는 읽을 수 없기 때문이다.
const fs = require("fs");
const net = require("net");
const { chromium } = require("playwright");

const API = process.env.API || "http://g529-be:8080/api/v1";
const FE = "http://localhost:13000";
const GROUPS = Number(process.env.GROUPS || 1);
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

// 컨테이너 안 localhost:13000을 측정 PC로 중계한다. Next 서버가 localhost가 아닌 주소의 요청을 차단하기 때문이다
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

async function member(tag, i) {
  const email = `load-${tag}-u${i}-${Date.now()}@test.local`;
  const s = await api("POST", "/auth/signup", {
    email, password: PASSWORD, nickname: `${tag}-${i}`,
    agreements: ["TERMS", "PRIVACY", "RECORDING"].map((termsType) => ({ termsType, termsVersion: "1.0" })),
  });
  if (s.status !== 201) throw new Error(`가입 ${s.status} ${s.text}`);
  const a = await api("POST", "/applications", { companyName: "한끗테크", jobTitle: "백엔드 개발자", coverLetterItems: COVER }, s.json.accessToken);
  if (a.status !== 201) throw new Error(`지원서 ${a.status} ${a.text}`);
  return { i, email, token: s.json.accessToken, applicationId: a.json.id };
}

const HOOK = `(() => {
  window.__msgs = [];
  const parse = JSON.parse;
  JSON.parse = function (text, rev) {
    if (typeof text === "string" && text.length < 200000 && (/"type"\\s*:\\s*"question"/.test(text) || /^\\{"turnVersion"/.test(text))) {
      window.__msgs.push({ t: Date.now(), s: text });
    }
    return parse.call(this, text, rev);
  };
})();`;

async function browser(b, media) {
  const ctx = await b.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
  await ctx.addInitScript(HOOK);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  return page;
}

async function login(page, email) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(`${FE}/login`, { waitUntil: "networkidle", timeout: 180000 });
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page.waitForURL(/\/home$/, { timeout: 90000 });
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
}

function launch(media) {
  return chromium.launch({
    args: [
      "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${CAMERA}`,
      `--use-file-for-fake-audio-capture=${MEDIA}/${media}.wav`,
      `--unsafely-treat-insecure-origin-as-secure=${FE}`,
      "--autoplay-policy=no-user-gesture-required",
      "--disable-3d-apis", "--disable-webgl",
    ],
  });
}

async function runGroup(g) {
  const tag = `g${g}-${Date.now() % 100000}`;
  const r = { tag, events: [], questions: [] };
  const users = [];
  for (const i of [1, 2, 3]) users.push(await member(tag, i));
  const S = {};
  for (const u of users) {
    S[u.i] = { b: await launch(`u${u.i}${VOICE}`) };
    S[u.i].page = await browser(S[u.i].b);
    await login(S[u.i].page, u.email);
  }
  const p1 = S[1].page;
  await p1.goto(`${FE}/practice/interviewer?applicationId=${users[0].applicationId}`);
  await p1.getByText("개발자 커피챗", { exact: true }).click();
  await p1.getByRole("button", { name: "다음: 면접 방식" }).click();
  await p1.getByText("화상으로 할래요", { exact: true }).click();
  await p1.getByText("친구와 함께 볼래요").click();
  await p1.getByRole("button", { name: "다음: 그룹 만들기" }).click();
  await p1.waitForURL(/\/groups\/new/);
  await p1.getByRole("button", { name: "그룹 만들기" }).click();
  await p1.waitForURL(/\/groups\/\d+$/);
  r.groupId = Number(p1.url().match(/\/groups\/(\d+)$/)[1]);
  r.joinAt = { 1: Date.now() };
  const code = (await api("GET", `/interview-groups/${r.groupId}`, null, users[0].token)).json.inviteCode;
  for (const i of [2, 3]) {
    const p = S[i].page;
    await p.goto(`${FE}/groups/invite/${code}`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "참가하기" }).click();
    await p.waitForURL(new RegExp(`/groups/${r.groupId}$`));
    r.joinAt[i] = Date.now();
  }
  log(tag, "그룹", r.groupId, "참가 끝");
  for (const i of [1, 2, 3]) await S[i].page.getByRole("button", { name: "준비 완료" }).click({ timeout: 180000 });
  const startBtn = p1.getByRole("button", { name: "면접 시작" });
  const readyFrom = Date.now();
  while (!(await startBtn.isEnabled().catch(() => false))) {
    if (Date.now() - readyFrom > 300000) throw new Error("5분 안에 [면접 시작]이 켜지지 않았다");
    await sleep(1000);
  }
  r.startEnabledAt = Date.now();
  await startBtn.click();
  r.startClickedAt = Date.now();
  for (const i of [1, 2, 3]) await S[i].page.waitForURL(/\/interview\/\d+$/);
  for (const u of users) u.sessionId = Number(S[u.i].page.url().match(/\/interview\/(\d+)$/)[1]);
  r.sessions = users.map((u) => ({ i: u.i, sessionId: u.sessionId }));
  log(tag, "면접방 입장", JSON.stringify(r.sessions));

  // 세 화면에서 모두 수집한다. 자기 질문을 모두 마친 참가자는 BE가 면접방에서 퇴장시키므로(group-room.tsx 216줄)
  // 한 화면만 확인하면 그 뒤 다른 참가자의 차례를 누락한다. 같은 단계 · 질문은 가장 먼저 수신한 시각만 남긴다
  const seenEvent = new Set();
  const seenQuestion = new Set();
  const until = Date.now() + 45 * 60 * 1000;
  while (Date.now() < until) {
    for (const s of Object.values(S)) {
      const list = await s.page.evaluate(() => window.__msgs.splice(0)).catch(() => []);
      for (const raw of list) {
        let m;
        try { m = JSON.parse(raw.s); } catch { continue; }
        if (m.turnVersion !== undefined) {
          const t = m.turn;
          const key = `${m.turnVersion} ${m.groupStatus} ${m.phase}`;
          if (!seenEvent.has(key)) {
            seenEvent.add(key);
            r.events.push({ t: raw.t, groupStatus: m.groupStatus, phase: m.phase, turnVersion: m.turnVersion, turn: t ? { sessionId: t.sessionId, seq: t.seq, kind: t.kind } : null });
          }
          if (m.groupStatus === "ENDED") r.ended = raw.t;
        } else if (m.type === "question" && m.speech === "started") {
          const key = `${m.sessionId}:${m.seq}`;
          if (!seenQuestion.has(key)) {
            seenQuestion.add(key);
            r.questions.push({ t: raw.t, sessionId: m.sessionId, seq: m.seq, kind: m.kind ?? null });
          }
        }
      }
    }
    if (r.ended) break;
    // 그룹이 끝나면 면접방이 닫혀 ENDED 방 정보가 화면에 도착하지 않을 수 있으므로 10초마다 그룹 상태 API(10.4)로도 확인한다
    if (Date.now() - (r.polledAt || 0) > 10000) {
      r.polledAt = Date.now();
      const gs = await api("GET", `/interview-groups/${r.groupId}`, null, users[0].token);
      if (gs.json?.status === "ENDED") r.ended = Date.now();
    }
    if (r.ended) break;
    await sleep(500);
  }
  delete r.polledAt;
  log(tag, r.ended ? "그룹 끝" : "45분 초과", "질문", r.questions.length);
  // 녹화 대기 중에 중단해도 면접 기록이 남게 그룹마다 먼저 저장한다
  fs.writeFileSync(`${OUT}/${tag}-interview.json`, JSON.stringify(r, null, 1));

  // 다시보기 구간(질문 시작 · 답변 끝)은 녹화 합치기가 끝나야 조회된다
  r.replays = {};
  const replayUntil = Date.now() + 25 * 60 * 1000;
  while (Date.now() < replayUntil) {
    let done = true;
    for (const u of users) {
      const rp = await api("GET", `/interview-sessions/${u.sessionId}/replay`, null, u.token);
      r.replays[u.i] = rp.json;
      const st = rp.json?.videoStatus;
      if (rp.status === 200 && st !== "READY" && st !== "FAILED") done = false;
    }
    if (done) break;
    await sleep(15000);
  }
  for (const s of Object.values(S)) await s.b.close();
  return r;
}

(async () => {
  const results = await Promise.all(Array.from({ length: GROUPS }, (_, g) => runGroup(g + 1).catch((e) => ({ error: e.message }))));
  const file = `${OUT}/run-${new Date(t0).toISOString().replace(/[:.]/g, "-")}-g${GROUPS}.json`;
  fs.writeFileSync(file, JSON.stringify({ startedAt: t0, groups: GROUPS, results }, null, 1));
  log("저장", file);
  process.exit(results.some((x) => x.error) ? 1 : 0);
})();
