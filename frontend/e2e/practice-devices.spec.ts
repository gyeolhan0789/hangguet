import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import type { SessionCreateRequest } from "../src/types/api";

import { APPLICATION, PROBLEM, SESSION, SESSION_PLAN, SESSION_STARTED } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, recordSessions, test } from "./test";

// S05 장치 점검
// 근거: Figma S05 장치 점검(18:2333) · S05-E 권한 거부(18:4013) · 기획 메모 S05(18:752: 생성 완료 + 장치 모두 ✓일 때만
//   [면접 시작], 생성 실패 시 재시도, 권한 거부 시 안내 모달 + 다시 시도) · 기획 메모 S05-E(18:3468: [채팅으로 면접 보기] → S06-B)
//   · Swagger 5.2 면접 조회(2초마다) · 5.3 면접 플랜 재생성 · 5.4 면접 시작(Idempotency-Key)
// 마이크 녹음 → 스피커 재생 흐름은 [면접 시작] 테스트들이 checkVoice로 거친다.
// 카메라 · 마이크는 Chromium의 가짜 장치(--use-fake-device-for-media-stream)를 쓰고, 권한은 브라우저 컨텍스트로 주고 뺀다.
// 기본 headless shell은 카메라 · 마이크를 지원하지 않아(NotSupportedError) 이 파일만 새 headless 모드(channel: "chromium")로 돌린다.
// 오류 이름별 문구 · 소리 크기 계산 · 체크 순서 · 장치 끊김 · 녹음 정리는 단위 · 컴포넌트 테스트가,
// 5.3 · 5.4 응답별 처리는 단위 테스트(interview/actions.test.ts)가 맡는다.

const S05 = `/practice/devices?sessionId=${SESSION.id}`;

test.use({
  channel: "chromium",
  launchOptions: { args: ["--use-fake-device-for-media-stream"] },
  permissions: ["camera", "microphone"],
});

const checklist = (page: Page) => page.getByRole("main").getByRole("list", { name: "장치 점검" });
/** 제목으로 체크 줄을 찾는다(스피커 줄 설명에도 '마이크'가 들어갈 수 있어 제목 글자 전체로 맞춘다). */
const row = (page: Page, title: string) =>
  checklist(page)
    .getByRole("listitem")
    .filter({ has: page.getByText(title, { exact: true }) });
const startButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "면접 시작" });
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "카메라 · 마이크 권한이 필요해요" });

/** 5.2가 늘 같은 질문 준비 상태로 답한다. */
function planIs(msw: MswFixture, plan: keyof typeof SESSION_PLAN) {
  msw.use(
    http.get(api("/interview-sessions/:sessionId"), () => HttpResponse.json(SESSION_PLAN[plan])),
  );
}

/**
 * 마이크 [녹음하기] → 3초 녹음('지금 말해 보세요') → 마이크 확인 · 스피커 [들어보기] 켜짐 → 누르면 녹음한 소리 재생
 * → 다 들으면 '잘 들렸나요?'(아직 확인 아님) → [잘 들려요]를 눌러야 스피커 확인.
 * 녹음 전에는 [들어보기]가 꺼져 있다. 실제 MediaRecorder 녹음 · 재생을 거치므로 6초쯤 걸린다.
 */
async function checkVoice(page: Page) {
  const mic = row(page, "마이크");
  const speaker = row(page, "스피커");
  const listen = speaker.getByRole("button", { name: "들어보기" });
  await expect(listen).toBeDisabled();

  await mic.getByRole("button", { name: "녹음하기" }).click();
  await expect(mic).toContainText("지금 말해 보세요");
  await expect(mic).toContainText("목소리가 잘 들려요", { timeout: 6_000 });
  await expect(mic).toContainText("확인됨");

  await listen.click();
  await expect(speaker).toContainText("재생하고 있어요");
  await expect(speaker).toContainText("잘 들렸나요?", { timeout: 6_000 });
  await expect(speaker).not.toContainText("확인됨");
  await speaker.getByRole("button", { name: "잘 들려요" }).click();
  await expect(speaker).toContainText("확인됨");
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S05 장치 점검 · 화면", () => {
  test("4단계 진행 표시 · 제목 · 체크 줄 4개 · 질문 준비 78% · 버튼이 보이고, [면접 시작]은 비활성이다", async ({
    page,
  }) => {
    await page.goto(S05);
    const main = page.getByRole("main");

    const steps = main.getByRole("list", { name: "면접 준비 단계" }).getByRole("listitem");
    await expect(steps.filter({ hasText: "장치 점검" })).toHaveAttribute("aria-current", "step");
    await expect(steps.filter({ hasText: "면접 방식" })).toContainText("완료");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("면접 전에 장치를 확인해요");
    await expect(main.getByText("모두 확인되면 바로 시작할 수 있어요")).toBeVisible();

    await expect(checklist(page).getByRole("listitem")).toHaveCount(4);
    await expect(main.getByRole("progressbar", { name: "질문 준비" })).toHaveAttribute(
      "aria-valuenow",
      "78",
    );
    await expect(main.getByText("면접관이 질문을 준비하고 있어요")).toBeVisible();
    await expect(main.getByRole("link", { name: "면접 방식" })).toHaveAttribute(
      "href",
      `/practice/mode?applicationId=${APPLICATION.id}&persona=DEVIL`,
    );
    await expect(startButton(page)).toBeDisabled();
  });

  test("카메라 · 네트워크가 확인되면 초록 체크와 Figma 문구로 바뀌고, 마이크는 [녹음하기]가 나오며, 미리보기에 영상 · 연결 표시 · 소리 막대가 나온다", async ({
    page,
  }) => {
    await page.goto(S05);

    await expect(row(page, "카메라")).toContainText("잘 보이고 있어요");
    await expect(row(page, "카메라")).toContainText("확인됨");
    await expect(row(page, "마이크").getByRole("button", { name: "녹음하기" })).toBeEnabled();
    await expect(row(page, "네트워크")).toContainText("연결 상태 양호");
    await expect(row(page, "네트워크")).toContainText("확인됨");

    const main = page.getByRole("main");
    await expect(main.getByText("카메라 연결됨")).toBeVisible();
    // 가짜 카메라 영상이 실제로 재생된다.
    await expect
      .poll(() =>
        main
          .getByLabel("내 카메라 화면")
          .evaluate((video: HTMLVideoElement) => video.readyState >= 2 && video.videoWidth > 0),
      )
      .toBe(true);
    // 가짜 마이크의 삐 소리에 맞춰 소리 크기가 올라간다.
    // 주소로 바로 들어오면 사용자 동작이 없어 브라우저 자동재생 정책상 AudioContext가 멈춘 채 시작될 수 있다.
    // 실제로는 S05-1 [다음]을 눌러 들어오고, 화면은 첫 클릭 때 다시 깨운다. 사용자처럼 한 번 누른 뒤 본다.
    await main.getByRole("heading", { level: 1 }).click();
    await expect
      .poll(
        async () =>
          Number(
            await main
              .getByRole("meter", { name: "마이크 소리 크기" })
              .getAttribute("aria-valuenow"),
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });

  test("오프라인이 되면 네트워크 줄이 실패로 바뀌고, 다시 연결되면 양호로 돌아온다", async ({
    page,
    context,
  }) => {
    await page.goto(S05);
    await expect(row(page, "네트워크")).toContainText("연결 상태 양호");

    await context.setOffline(true);
    await expect(row(page, "네트워크")).toContainText("인터넷 연결이 끊겼어요");
    await expect(row(page, "네트워크")).toContainText("확인 안 됨");

    await context.setOffline(false);
    await expect(row(page, "네트워크")).toContainText("연결 상태 양호");
  });
});

test.describe("S05 장치 점검 · 질문 준비(5.2 · 5.3)", () => {
  test("준비 중이면 다시 조회하고(2초 간격 · 멈춤은 컴포넌트 테스트), 준비가 끝나면 100%로 바뀐다", async ({
    page,
    msw,
  }) => {
    let calls = 0;
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json(++calls === 1 ? SESSION_PLAN.GENERATING : SESSION_PLAN.READY),
      ),
    );
    await page.goto(S05);
    const progress = page.getByRole("main").getByRole("progressbar", { name: "질문 준비" });
    await expect(progress).toHaveAttribute("aria-valuenow", "78");

    await expect(progress).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByRole("main").getByText("면접관이 질문을 준비했어요")).toBeVisible();
  });

  test("준비가 실패하면 [다시 시도]로 5.3을 부르고, 다시 준비 중으로 돌아간다", async ({
    page,
    msw,
  }) => {
    const retried: string[] = [];
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json(retried.length > 0 ? SESSION_PLAN.GENERATING : SESSION_PLAN.FAILED),
      ),
      http.post(api("/interview-sessions/:sessionId/plan/retry"), ({ params }) => {
        retried.push(String(params.sessionId));
        return HttpResponse.json({ ...SESSION_PLAN.GENERATING, planProgress: 0 }, { status: 202 });
      }),
    );
    await page.goto(S05);
    const main = page.getByRole("main");
    await expect(main.getByText("질문을 준비하지 못했어요")).toBeVisible();

    await main.getByRole("button", { name: "다시 시도" }).click();
    await expect(main.getByText("면접관이 질문을 준비하고 있어요")).toBeVisible();
    expect(retried).toEqual([String(SESSION.id)]);
  });
});

test.describe("S05 장치 점검 · 면접 시작(5.4)", () => {
  test("장치가 모두 확인되고 질문 준비가 끝나야 [면접 시작]이 켜지고, 누르면 멱등 키와 함께 5.4를 불러 면접 화면으로 간다", async ({
    page,
    msw,
  }) => {
    planIs(msw, "READY");
    const keys: (string | null)[] = [];
    msw.use(
      http.post(api("/interview-sessions/:sessionId/start"), ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        return HttpResponse.json(SESSION_STARTED);
      }),
    );
    await page.goto(S05);
    await expect(row(page, "네트워크")).toContainText("확인됨");
    // 마이크 녹음 · 스피커 재생을 하기 전에는 켜지지 않는다.
    await expect(startButton(page)).toBeDisabled();

    await checkVoice(page);
    await expect(startButton(page)).toBeEnabled();
    await startButton(page).click();

    await expect(page).toHaveURL(`/interview/${SESSION.id}`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("5.4가 실패하면(409 PLAN_NOT_READY) 서버 문구를 보여 주고 이 화면에 머문다", async ({
    page,
    msw,
  }) => {
    planIs(msw, "READY");
    msw.use(
      http.post(api("/interview-sessions/:sessionId/start"), () =>
        problemResponse(PROBLEM.PLAN_NOT_READY),
      ),
    );
    await page.goto(S05);
    await checkVoice(page);
    await startButton(page).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      PROBLEM.PLAN_NOT_READY.detail,
    );
    await expect(page).toHaveURL(S05);
  });
});

test.describe("S05-E 권한 거부", () => {
  test.use({ permissions: [] });

  test("카메라 · 마이크 권한이 없으면 두 줄이 '권한이 없어요'로 바뀌고 권한 안내 모달이 뜬다", async ({
    page,
  }) => {
    await page.goto(S05);

    await expect(row(page, "카메라")).toContainText("권한이 없어요");
    await expect(row(page, "마이크")).toContainText("권한이 없어요");
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAccessibleDescription(
      "화상 면접은 카메라와 마이크로 진행돼요",
    );
    await expect(dialog(page).getByRole("listitem")).toContainText([
      "주소창 왼쪽 자물쇠 아이콘을 눌러요",
      "카메라 · 마이크를 '허용'으로 바꿔요",
      "아래 [다시 확인하기]를 눌러요",
    ]);
    await expect(dialog(page).getByRole("button", { name: "다시 확인하기" })).toBeFocused();
  });

  test("권한을 허용하고 [다시 확인하기]를 누르면 모달이 닫히고 두 줄이 확인된다", async ({
    page,
    context,
  }) => {
    await page.goto(S05);
    await expect(dialog(page)).toBeVisible();

    await context.grantPermissions(["camera", "microphone"]);
    await dialog(page).getByRole("button", { name: "다시 확인하기" }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(row(page, "카메라")).toContainText("잘 보이고 있어요");
    await expect(row(page, "마이크").getByRole("button", { name: "녹음하기" })).toBeEnabled();
  });

  test("모달 안에서 Tab · Shift+Tab은 두 버튼 사이만 돈다", async ({ page }) => {
    await page.goto(S05);
    const recheck = dialog(page).getByRole("button", { name: "다시 확인하기" });
    const chat = dialog(page).getByRole("button", { name: "채팅으로 면접 보기" });
    await expect(recheck).toBeFocused();

    // 마지막 버튼에서 Tab → 첫 버튼, 첫 버튼에서 Shift+Tab → 마지막 버튼
    await page.keyboard.press("Tab");
    await expect(chat).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(recheck).toBeFocused();
  });

  test("[채팅으로 면접 보기]는 같은 지원서 · 면접관으로 채팅 면접을 만들어(5.1) 면접 화면으로 간다", async ({
    page,
    msw,
  }) => {
    const requests = recordSessions(msw, (body) =>
      HttpResponse.json({ ...SESSION, id: 56, mode: body.mode }, { status: 201 }),
    );
    await page.goto(S05);
    await dialog(page).getByRole("button", { name: "채팅으로 면접 보기" }).click();

    await expect(page).toHaveURL("/interview/56");
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      applicationId: APPLICATION.id,
      persona: "DEVIL",
      mode: "CHAT",
    } satisfies SessionCreateRequest);
    expect(requests[0].key).toMatch(/^[0-9a-f-]{36}$/);
  });
});

test.describe("S05 장치 점검 · 주소", () => {
  test.use({ permissions: [] });

  for (const [label, path] of [
    ["sessionId가 없으면", "/practice/devices"],
    ["sessionId 형식이 틀리면", "/practice/devices?sessionId=abc"],
  ] as const) {
    test(`${label} S03 지원서 입력으로 보낸다`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL("/practice");
    });
  }

  test("면접이 없으면(404 SESSION_NOT_FOUND) S03 지원서 입력으로 보낸다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        problemResponse(PROBLEM.SESSION_NOT_FOUND),
      ),
    );
    await page.goto(S05);
    await expect(page).toHaveURL("/practice");
  });

  test("채팅 면접이면 장치 점검 없이 면접 화면으로 보낸다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json({ ...SESSION_PLAN.READY, mode: "CHAT" }),
      ),
    );
    await page.goto(S05);
    await expect(page).toHaveURL(`/interview/${SESSION.id}`);
  });

  // 목 서버 5.2는 늘 첫 예시(면접 중)를 주므로 상태로는 다른 화면에 보내지 않는다.
  test("면접 상태가 시작 전이 아니어도(목 서버 5.2 첫 예시 IN_PROGRESS) S05를 보여 준다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json({ ...SESSION_PLAN.READY, status: "IN_PROGRESS" }),
      ),
    );
    await page.goto(S05);
    await expect(page).toHaveURL(S05);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(
      "면접 전에 장치를 확인해요",
    );
  });
});
