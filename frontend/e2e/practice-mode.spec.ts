import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";
import type { SessionCreateRequest } from "../src/types/api";

import { APPLICATION, PROBLEM, SESSION, SESSION_PLAN } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, recordSessions, test } from "./test";

// S05-1 면접 방식 선택
// 근거: Figma S05-1 면접 방식 선택(18:2219) · 기획 메모 S05-1(18:1013: 화상 → S05 장치 점검 · 채팅 → 바로 면접,
//   [다음] 문구 화상 '다음: 장치 점검' · 채팅 '면접 시작', [다음]을 누를 때 면접 만들기) · Swagger 5.1 면접 만들기(Idempotency-Key)
// 아이콘 연출(고른 카드만 반복 · 동작 줄이기)은 컴포넌트 테스트(mode-icon.test.tsx)가, 5.1 응답별 처리 · 입력 검증은
// 단위 테스트(interview/actions.test.ts)가, 주소 값 경계값은 단위 테스트(queries · personas)가 맡는다.

const S05_1 = `/practice/mode?applicationId=${APPLICATION.id}&persona=DEVIL`;

const modeGroup = (page: Page) => page.getByRole("main").getByRole("group", { name: "면접 방식" });
const mode = (page: Page, name: string) => modeGroup(page).getByRole("radio", { name });
/** 사용자는 숨긴 라디오가 아니라 카드(라벨)를 누른다. */
const choose = (page: Page, name: string) =>
  modeGroup(page).getByText(name, { exact: true }).click();
const nextButton = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /다음: 장치 점검|면접 시작/ });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S05-1 면접 방식 선택 · 화면", () => {
  test("3단계 진행 표시 · 제목 · 면접관과 지원서 · 방식 두 개 · 버튼이 보이고, 처음에는 [다음]이 비활성이다", async ({
    page,
  }) => {
    await page.goto(S05_1);
    const main = page.getByRole("main");

    const steps = main.getByRole("list", { name: "면접 준비 단계" }).getByRole("listitem");
    await expect(steps.filter({ hasText: "면접 방식" })).toHaveAttribute("aria-current", "step");
    await expect(steps.filter({ hasText: "지원서" })).toContainText("완료");
    await expect(steps.filter({ hasText: "면접관 선택" })).toContainText("완료");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("어떻게 면접 볼까요?");
    await expect(
      main.getByText(`악마 면접관 · ${APPLICATION.companyName} ${APPLICATION.jobTitle}`),
    ).toBeVisible();

    await expect(modeGroup(page).getByRole("radio")).toHaveCount(2);
    await expect(modeGroup(page).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "면접관 선택" })).toBeVisible();
    await expect(nextButton(page)).toBeDisabled();
  });

  test("고른 방식에 따라 [다음] 문구가 바뀐다: 화상 '다음: 장치 점검' · 채팅 '면접 시작'", async ({
    page,
  }) => {
    await page.goto(S05_1);

    await choose(page, "채팅으로 할래요");
    await expect(nextButton(page)).toHaveAccessibleName("면접 시작");
    await choose(page, "화상으로 할래요");
    await expect(nextButton(page)).toHaveAccessibleName("다음: 장치 점검");
  });

  test("키보드로 방식 목록에 들어와 고르고, 방향키로 바꿀 수 있다", async ({ page }) => {
    await page.goto(S05_1);

    // 목록 바로 앞(부제목)에서 Tab으로 들어온다: 아무것도 고르지 않았으면 첫 방식(화상)에 포커스가 간다.
    await page
      .getByRole("main")
      .getByText(`악마 면접관 · ${APPLICATION.companyName}`, { exact: false })
      .click();
    await page.keyboard.press("Tab");
    await expect(mode(page, "화상으로 할래요")).toBeFocused();
    await page.keyboard.press("Space");
    await expect(mode(page, "화상으로 할래요")).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(mode(page, "채팅으로 할래요")).toBeChecked();
    await expect(nextButton(page)).toHaveAccessibleName("면접 시작");
  });
});

test.describe("S05-1 면접 방식 선택 · 면접 만들기 (5.1)", () => {
  test("화상을 고르고 [다음: 장치 점검]을 누르면 지원서 · 면접관 · 방식으로 면접을 만들고 S05 장치 점검으로 간다", async ({
    page,
    msw,
  }) => {
    const requests = recordSessions(msw);
    await page.goto(S05_1);

    await choose(page, "화상으로 할래요");
    await expect(mode(page, "화상으로 할래요")).toBeChecked();
    await page.getByRole("button", { name: "다음: 장치 점검" }).click();

    await expect(page).toHaveURL(`/practice/devices?sessionId=${SESSION.id}`);
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({
      applicationId: APPLICATION.id,
      persona: "DEVIL",
      mode: "VIDEO",
    } satisfies SessionCreateRequest);
    expect(requests[0].key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("채팅을 고르면 [다음]이 '면접 시작'으로 바뀌고, 누르면 장치 점검 없이 바로 면접으로 간다", async ({
    page,
    msw,
  }) => {
    const requests = recordSessions(msw);
    // 만든 면접은 채팅이다(5.2도 채팅 면접으로 답한다). 화상 시작 전이면 면접 화면이 S05로 돌려보낸다.
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json({ ...SESSION_PLAN.GENERATING, mode: "CHAT" }),
      ),
    );
    await page.goto(S05_1);

    await choose(page, "채팅으로 할래요");
    await expect(nextButton(page)).toHaveAccessibleName("면접 시작");
    await nextButton(page).click();

    await expect(page).toHaveURL(`/interview/${SESSION.id}`);
    expect(requests.map(({ body }) => body.mode)).toEqual(["CHAT"]);
  });

  test("응답을 기다리는 동안 [다음]을 다시 누를 수 없어 면접이 한 번만 만들어진다", async ({
    page,
    msw,
  }) => {
    let respond!: () => void;
    const responded = new Promise<void>((resolve) => (respond = resolve));
    let calls = 0;
    msw.use(
      http.post(api("/interview-sessions"), async () => {
        calls += 1;
        await responded;
        return HttpResponse.json(SESSION, { status: 201 });
      }),
    );
    await page.goto(S05_1);

    try {
      await choose(page, "화상으로 할래요");
      await nextButton(page).click();

      await expect(nextButton(page)).toBeDisabled();
      await expect(nextButton(page)).toHaveAttribute("aria-busy", "true");
      // 기다리는 동안 다시 제출해 본다: 고른 카드에서 Enter(폼 제출)
      await mode(page, "화상으로 할래요").press("Enter");
    } finally {
      respond();
    }
    await expect(page).toHaveURL(`/practice/devices?sessionId=${SESSION.id}`);
    expect(calls).toBe(1);
  });

  // 웹 Swagger Idempotency-Key: 같은 키 · 같은 본문이면 처음 결과를 그대로 반환한다.
  // 서버가 실패로 답했으면(500 ProblemDetail) 새 키로, 응답을 못 받았으면(연결 오류) 같은 키로 다시 보낸다.
  test("만들지 못하면 안내하고, 서버가 실패로 답했으면 새 키 · 연결 오류면 같은 키로 다시 보내며, 방식을 바꾸면 다른 키로 보낸다", async ({
    page,
    msw,
  }) => {
    // 서버가 어떻게 답할지는 테스트가 단계마다 바꾼다.
    let reply: "server-error" | "network-error" = "server-error";
    const requests = recordSessions(msw, () =>
      reply === "server-error" ? problemResponse(PROBLEM.INTERNAL_ERROR) : HttpResponse.error(),
    );
    await page.goto(S05_1);

    await choose(page, "화상으로 할래요");
    await nextButton(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      PROBLEM.INTERNAL_ERROR.detail,
    );
    await expect(page).toHaveURL(S05_1);

    reply = "network-error";
    await nextButton(page).click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(nextButton(page)).toBeEnabled();
    await nextButton(page).click();
    await expect.poll(() => requests.length).toBe(3);
    await choose(page, "채팅으로 할래요");
    await nextButton(page).click();
    await expect.poll(() => requests.length).toBe(4);

    const [first, afterServerError, afterNetworkError, chat] = requests;
    expect(afterServerError.key).not.toBe(first.key);
    expect(afterNetworkError.key).toBe(afterServerError.key);
    expect(chat.key).not.toBe(afterNetworkError.key);
    expect(chat.body.mode).toBe("CHAT");
  });

  test("로그인이 풀렸으면(401 UNAUTHORIZED) 쿠키를 지우고 로그인 화면으로 보낸다", async ({
    page,
    context,
    msw,
  }) => {
    msw.use(http.post(api("/interview-sessions"), () => problemResponse(PROBLEM.UNAUTHORIZED)));
    await page.goto(S05_1);

    await choose(page, "화상으로 할래요");
    await nextButton(page).click();

    await expect(page).toHaveURL("/login");
    expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain(
      ACCESS_TOKEN_COOKIE,
    );
  });
});

test.describe("S05-1 면접 방식 선택 · 이동", () => {
  test("[← 면접관 선택]을 누르면 고른 면접관이 골라진 채로 S04로 돌아간다", async ({ page }) => {
    await page.goto(S05_1);

    await page.getByRole("link", { name: "면접관 선택" }).click();

    await expect(page).toHaveURL(
      `/practice/interviewer?applicationId=${APPLICATION.id}&persona=DEVIL`,
    );
    await expect(page.getByRole("main").getByRole("radio", { name: "악마 면접관" })).toBeChecked();
  });

  test("면접관을 고르지 않고 오면 S04 면접관 선택으로 돌려보낸다", async ({ page }) => {
    await page.goto(`/practice/mode?applicationId=${APPLICATION.id}`);

    await expect(page).toHaveURL(`/practice/interviewer?applicationId=${APPLICATION.id}`);
  });

  test("지원서를 찾을 수 없으면(404) S03 지원서 입력으로 돌려보낸다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/applications/:applicationId"), () =>
        problemResponse(PROBLEM.APPLICATION_NOT_FOUND),
      ),
    );
    await page.goto(S05_1);

    await expect(page).toHaveURL("/practice");
  });
});
