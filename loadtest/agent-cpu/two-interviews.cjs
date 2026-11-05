// 화상 면접 2건을 같은 순간에 시작해 끝까지 진행한다(에이전트 CPU 측정용). 보고서: ../report/agent-cpu-dev-2026-11-05.md
// 흐름은 ../lib/browser-interview.js(k6 browser)를 Playwright로 옮긴 것이다. 결과 · 다시보기는 기다리지 않는다.
// - 브라우저: 설치된 크롬(channel: chrome)을 따로 만든 프로필(loadtest/results/agent-cpu/pw-profile)로 띄운다.
//   가짜 마이크 · 카메라는 ../media/answer.wav · camera.y4m(make-media.ps1)
// - 로그인은 사람이 창에서 직접 한다. 스크립트는 홈 화면이 뜰 때까지 기다린 뒤 첫 지원서로 진행한다
// 실행(레포 루트): node loadtest/agent-cpu/two-interviews.cjs   (BASE_URL로 대상 주소를 바꿀 수 있다)
const path = require("path");
const fs = require("fs");

const REPO = path.resolve(__dirname, "..", "..");
const { chromium } = require(path.join(REPO, "frontend", "node_modules", "@playwright/test"));

const BASE_URL = process.env.BASE_URL ?? "https://hangguet.yobistory.com";
const OUT = path.join(REPO, "loadtest", "results", "agent-cpu");
const AUDIO = path.join(REPO, "loadtest", "media", "answer.wav");
const VIDEO = path.join(REPO, "loadtest", "media", "camera.y4m");
const PERSONA = "개발자 커피챗";

const now = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
const log = (msg) => console.log(`${now()} ${msg}`);

async function waitForUrl(page, pattern, seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (pattern.test(page.url())) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function findApplicationId(page) {
  await page.goto(`${BASE_URL}/applications`, { waitUntil: "networkidle" });
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const id = hrefs.map((h) => /\/applications\/(\d+)$/.exec(h ?? "")?.[1]).find(Boolean);
  if (!id) throw new Error("지원서가 없다. 지원서를 하나 만든 뒤 다시 실행한다");
  return id;
}

/** 질문 준비까지 진행한다. 돌려준 start()가 면접방에 들어가 결과 분석 화면까지 진행한다 */
async function prepareInterview(page, applicationId, name) {
  const t = { name };
  await page.goto(`${BASE_URL}/practice/interviewer?applicationId=${applicationId}`);
  await page.getByText(PERSONA, { exact: true }).click();
  await page.getByRole("button", { name: "다음: 면접 방식" }).click();
  await page.getByText("화상으로 할래요", { exact: true }).click();
  await page.getByRole("button", { name: "다음: 장치 점검" }).click();
  if (!(await waitForUrl(page, /\/practice\/devices\?sessionId=\d+/, 30))) throw new Error("장치 점검 화면으로 가지 않았다");
  t.sessionId = page.url().match(/sessionId=(\d+)/)[1];
  log(`${name} 면접 ${t.sessionId} 만듦`);
  await page.getByRole("button", { name: "녹음하기", exact: true }).click();
  await page.getByRole("button", { name: "들어보기", exact: true }).click({ timeout: 15000 });
  await page.getByRole("button", { name: "잘 들려요", exact: true }).click({ timeout: 15000 });
  await page.getByText("면접관이 질문을 준비했어요").waitFor({ timeout: 200000 });
  return {
    t,
    async start() {
      await page.getByRole("button", { name: "면접 시작", exact: true }).click();
      if (!(await waitForUrl(page, new RegExp(`/interview/${t.sessionId}$`), 30))) throw new Error("면접방으로 가지 않았다");
      t.roomAt = now();
      log(`${name} 면접방 입장`);
      const analyzing = page.getByText("면접관이 답변을 검토하고 있어요");
      const until = Date.now() + 15 * 60 * 1000;
      let lastSeq = 0;
      while (!(await analyzing.isVisible().catch(() => false))) {
        if (/\/result$/.test(page.url())) break;
        if (Date.now() > until) throw new Error("15분 안에 면접이 끝나지 않았다");
        const seq = Number(
          await page
            .locator('[role=progressbar][aria-label="질문 진행"]')
            .first()
            .getAttribute("aria-valuenow", { timeout: 1000 })
            .catch(() => 0),
        );
        if (seq > lastSeq) {
          log(`${name} 질문 ${seq}`);
          lastSeq = seq;
        }
        await page.waitForTimeout(2000);
      }
      t.endAt = now();
      log(`${name} 면접 끝(결과 분석 화면)`);
      return t;
    },
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const context = await chromium.launchPersistentContext(path.join(OUT, "pw-profile"), {
    headless: false,
    // Playwright 전용 브라우저를 내려받지 않고 설치된 크롬을 쓴다
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    permissions: ["camera", "microphone"],
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${AUDIO}`,
      `--use-file-for-fake-video-capture=${VIDEO}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const first = context.pages()[0] ?? (await context.newPage());
  await first.goto(`${BASE_URL}/home`);
  if (!/\/home$/.test(first.url())) {
    log("로그인 화면이 열렸다. 창에서 직접 로그인한다(최대 10분 기다림)");
    if (!(await waitForUrl(first, /\/home$/, 600))) throw new Error("10분 안에 로그인하지 않았다");
  }
  log("로그인 확인");
  const applicationId = await findApplicationId(first);
  log(`지원서 ${applicationId}로 진행`);
  const second = await context.newPage();
  // 질문 준비(PLAN)까지 따로 진행한 뒤, 두 면접을 같은 순간에 시작한다
  const ready = await Promise.all([
    prepareInterview(first, applicationId, "A"),
    prepareInterview(second, applicationId, "B"),
  ]);
  log("두 면접 질문 준비 완료, 동시에 시작");
  const results = await Promise.allSettled(ready.map((r) => r.start()));
  const summary = results.map((r, i) =>
    r.status === "fulfilled" ? r.value : { name: ready[i].t.name, error: String(r.reason) },
  );
  fs.writeFileSync(path.join(OUT, "two-interviews.json"), JSON.stringify(summary, null, 2));
  log(`결과: ${JSON.stringify(summary)}`);
  await context.close();
})().catch((e) => {
  log(`실패: ${e?.stack ?? e}`);
  process.exit(1);
});
