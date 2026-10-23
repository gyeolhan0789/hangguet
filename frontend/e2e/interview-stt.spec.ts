import type { RoomResponse } from "../src/types/api";

import { QUESTION_CURRENT, SESSION_INTERVIEW } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// 기준: 웹 Swagger 5.14 · 사용자 승인 S06 STT 자막 표시.
// 실제 RTC 시나리오는 외부에서 만든 임시 방·테스트 에이전트를 사용한다. 키는 브라우저로 보내지 않는다.
test.use({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  },
  permissions: ["camera", "microphone"],
});

test.beforeEach(async ({ page, signIn, msw }) => {
  await signIn();
  await page.route("**/interview/devil/interviewer.glb", (route) => route.fulfill({ status: 404 }));
  msw.use(
    http.get(api("/interview-sessions/:sessionId"), () =>
      HttpResponse.json(SESSION_INTERVIEW.IN_PROGRESS),
    ),
    http.get(api("/interview-sessions/:sessionId/questions/current"), () =>
      HttpResponse.json(QUESTION_CURRENT),
    ),
  );
});

test("입장 토큰 발급 실패를 표시하고 다시 연결을 요청할 수 있다", async ({ page, msw }) => {
  let requests = 0;
  msw.use(
    http.post(api("/interview-sessions/:sessionId/room-token"), () => {
      requests += 1;
      return problemResponse({
        title: "Conflict",
        status: 409,
        code: "INVALID_SESSION_STATE",
        detail: "지금은 할 수 없는 요청이에요.",
      });
    }),
  );
  await page.goto(`/interview/${SESSION_INTERVIEW.IN_PROGRESS.id}`);
  await expect(page.getByLabel("내 답변 음성 인식").getByRole("alert")).toContainText(
    "음성 인식에 연결하지 못했어요.",
  );
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "다시 연결" }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByLabel("내 답변 음성 인식")).toBeVisible();
});

test("마이크를 LiveKit으로 송출하고 에이전트가 보낸 텍스트를 표시한다", async ({
  page,
  msw,
}, testInfo) => {
  const url = process.env.STT_TEST_ROOM_URL;
  const token = process.env.STT_TEST_ROOM_TOKEN;
  test.skip(!url || !token, "실제 RTC 검증용 임시 방 토큰이 필요하다");
  const room: RoomResponse = {
    url: url!,
    token: token!,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  msw.use(
    http.post(api("/interview-sessions/:sessionId/room-token"), () => HttpResponse.json(room)),
  );
  await page.goto(`/interview/${SESSION_INTERVIEW.IN_PROGRESS.id}`);
  await expect(page.getByLabel("내 답변 음성 인식")).toContainText("LiveKit STT 연결 테스트", {
    timeout: 30_000,
  });
  await page.screenshot({ path: testInfo.outputPath("stt-desktop.png") });
  await page.reload();
  await expect(page.getByLabel("내 답변 음성 인식")).toContainText("LiveKit STT 연결 테스트", {
    timeout: 30_000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.getByLabel("내 답변 음성 인식")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("stt-mobile.png") });
});
