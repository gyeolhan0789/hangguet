import type { Page } from "@playwright/test";

import { APPLICATION, PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S03 지원서 입력
// 근거: Figma S03 지원서 입력(18:2033) · 메모 S03(MVP: 면접마다 새로 입력, 필수: 회사 · 직무 · 자소서, 빈칸이면 [다음] 비활성)
//   · 모션 메모 S03(글자 수: 2,800자 넘으면 주황 → 3,000자 빨강) · Swagger 4.1 지원서 작성
// 글자 수 경계값(2,800 · 2,801 · 3,000)과 색은 단위 테스트(cover-letter-counter.test.ts)가 맡고,
// 여기서는 사용자가 보고 듣는 흐름(글자 수 안내 · 버튼 상태 · 요청 · 이동)을 본다.

const nextButton = (page: Page) => page.getByRole("button", { name: "다음: 면접관 선택" });
const coverLetter = (page: Page) => page.getByLabel("자기소개서");

async function fillValidForm(page: Page) {
  await page.getByLabel("회사명").fill("○○전자");
  await page.getByLabel("직무").fill("백엔드 개발자");
  await coverLetter(page).fill("1. 지원 동기");
}

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S03 지원서 입력 · 화면", () => {
  test("1단계 진행 표시 · 제목 · 세 칸 · 안내 · 버튼이 보이고, 처음에는 [다음]이 비활성이다", async ({
    page,
  }) => {
    await page.goto("/practice");
    const main = page.getByRole("main");

    const steps = main.getByRole("list", { name: "면접 준비 단계" }).getByRole("listitem");
    await expect(steps).toHaveCount(5);
    await expect(steps.filter({ hasText: "지원서" })).toHaveAttribute("aria-current", "step");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("어떤 면접을 준비하나요?");
    await expect(main.getByText("지원서를 바탕으로 질문과 평가 기준을 만들어요")).toBeVisible();
    await expect(main.getByLabel("회사명")).toBeEmpty();
    await expect(main.getByLabel("직무")).toBeEmpty();
    await expect(coverLetter(page)).toBeEmpty();
    await expect(coverLetter(page)).toHaveAccessibleDescription("글자 수 0 / 3,000");
    await expect(
      main.getByText("자소서는 저장되지 않아요 · 면접할 때마다 새로 입력해요"),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/home");
    await expect(nextButton(page)).toBeDisabled();
  });
});

test.describe("S03 지원서 입력 · 필수 칸", () => {
  test("세 칸을 모두 채워야 [다음]이 활성화되고, 하나라도 비우면 다시 비활성이다", async ({
    page,
  }) => {
    await page.goto("/practice");

    await page.getByLabel("회사명").fill("○○전자");
    await page.getByLabel("직무").fill("백엔드 개발자");
    await expect(nextButton(page)).toBeDisabled();

    await coverLetter(page).fill("1. 지원 동기");
    await expect(nextButton(page)).toBeEnabled();

    await page.getByLabel("회사명").clear();
    await expect(nextButton(page)).toBeDisabled();
  });
});

test.describe("S03 지원서 입력 · 자기소개서 글자 수", () => {
  test("입력할 때마다 글자 수를 알려 주고, 끝이 가까워지거나 최대에 닿으면 그 상태도 알려 준다", async ({
    page,
  }) => {
    await page.goto("/practice");

    await coverLetter(page).fill("가".repeat(1248));
    await expect(coverLetter(page)).toHaveAccessibleDescription("글자 수 1,248 / 3,000");

    await coverLetter(page).fill("가".repeat(2801));
    await expect(coverLetter(page)).toHaveAccessibleDescription(
      "글자 수 2,801 / 3,000, 최대 글자 수에 가까워요",
    );

    await coverLetter(page).fill("가".repeat(3000));
    await expect(coverLetter(page)).toHaveAccessibleDescription(
      "글자 수 3,000 / 3,000, 최대 글자 수예요",
    );
  });

  test("3,000자에서는 더 입력되지 않는다", async ({ page }) => {
    await page.goto("/practice");

    await coverLetter(page).fill("가".repeat(2999));
    await coverLetter(page).pressSequentially("나다");

    await expect(coverLetter(page)).toHaveValue(`${"가".repeat(2999)}나`);
    await expect(coverLetter(page)).toHaveAccessibleDescription(
      "글자 수 3,000 / 3,000, 최대 글자 수예요",
    );
  });
});

test.describe("S03 지원서 입력 · 제출 (4.1)", () => {
  test("[다음]을 누르면 앞뒤 공백을 지운 세 칸을 보내고, 만든 지원서 id를 들고 S04 면접관 선택으로 간다", async ({
    page,
    msw,
  }) => {
    let body: unknown;
    msw.use(
      http.post(api("/applications"), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(APPLICATION, { status: 201 });
      }),
    );
    await page.goto("/practice");

    await page.getByLabel("회사명").fill(" ○○전자 ");
    await page.getByLabel("직무").fill("백엔드 개발자");
    await coverLetter(page).fill("1. 지원 동기\n저는…\n");
    await nextButton(page).click();

    await expect(page).toHaveURL(`/practice/interviewer?applicationId=${APPLICATION.id}`);
    expect(body).toEqual({
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      coverLetter: "1. 지원 동기\n저는…",
    });
  });

  test("응답을 기다리는 동안 [다음]을 다시 누를 수 없어 지원서가 한 번만 만들어진다", async ({
    page,
    msw,
  }) => {
    let calls = 0;
    let respond!: () => void;
    const responded = new Promise<void>((resolve) => (respond = resolve));
    msw.use(
      http.post(api("/applications"), async () => {
        calls += 1;
        await responded;
        return HttpResponse.json(APPLICATION, { status: 201 });
      }),
    );
    await page.goto("/practice");

    await fillValidForm(page);
    await nextButton(page).click();

    await expect(nextButton(page)).toBeDisabled();
    await expect(nextButton(page)).toHaveAttribute("aria-busy", "true");

    respond();
    await expect(page).toHaveURL(`/practice/interviewer?applicationId=${APPLICATION.id}`);
    expect(calls).toBe(1);
  });

  test("서버가 입력값을 거절하면(VALIDATION_FAILED) 해당 칸 아래에 서버 안내를 보여 주고, 고치면 안내가 사라지고 다시 낼 수 있다", async ({
    page,
    msw,
  }) => {
    const [companyError, coverLetterError] = PROBLEM.VALIDATION_FAILED_APPLICATION.errors;
    msw.use(
      http.post(api("/applications"), () => problemResponse(PROBLEM.VALIDATION_FAILED_APPLICATION)),
    );
    await page.goto("/practice");

    await fillValidForm(page);
    await nextButton(page).click();

    const company = page.getByLabel("회사명");
    await expect(company).toHaveAccessibleDescription(companyError.reason);
    await expect(company).toHaveAttribute("aria-invalid", "true");
    await expect(coverLetter(page)).toHaveAccessibleDescription(
      new RegExp(`${coverLetterError.reason}$`),
    );
    await expect(coverLetter(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("직무")).not.toHaveAttribute("aria-invalid");
    await expect(page).toHaveURL("/practice");
    await expect(nextButton(page)).toBeDisabled();

    await company.fill("○○전자 본사");
    await coverLetter(page).fill("1. 지원 동기\n저는…");
    await expect(company).toHaveAccessibleDescription("");
    await expect(company).not.toHaveAttribute("aria-invalid");
    await expect(coverLetter(page)).not.toHaveAttribute("aria-invalid");
    await expect(nextButton(page)).toBeEnabled();
  });

  test("서버 오류(500)면 서버 안내를 보여 주고, 입력한 값은 그대로 두어 다시 낼 수 있다", async ({
    page,
    msw,
  }) => {
    msw.use(http.post(api("/applications"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
    await page.goto("/practice");

    await fillValidForm(page);
    await nextButton(page).click();

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      PROBLEM.INTERNAL_ERROR.detail,
    );
    await expect(page).toHaveURL("/practice");
    await expect(page.getByLabel("회사명")).toHaveValue("○○전자");
    await expect(coverLetter(page)).toHaveValue("1. 지원 동기");
    await expect(nextButton(page)).toBeEnabled();
  });
});

test.describe("S03 지원서 입력 · 이동", () => {
  test("[홈으로] → S02 홈", async ({ page }) => {
    await page.goto("/practice");
    await page.getByRole("link", { name: "홈으로" }).click();

    await expect(page).toHaveURL("/home");
  });
});
