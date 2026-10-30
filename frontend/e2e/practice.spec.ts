import type { Page } from "@playwright/test";

import type { ApplicationCreateRequest } from "../src/types/api";

import { APPLICATION, APPLICATION_LIST } from "./mocks/data";
import { api, expect, http, HttpResponse, test } from "./test";

// S03 지원서 선택(기존 S03 지원서 입력을 대체)
// 근거: Figma S03 지원서 선택(화이트 · 다크) · 기획 메모 S03 지원서 선택(저장된 지원서를 라디오로 고름, [+ 추가하기]는 항상 보임 →
//   지원서 쓰기, 고른 지원서 id로 S04) · Swagger 4.3 지원서 목록 · 4.1 지원서 작성
//   · 사용자 결정(2026-10-29: 4.3을 size 20으로 한 번만, 빈 목록이면 '저장된 지원서가 없어요', 지원서 쓰기 저장 뒤 S03로 돌아와
//   새 지원서를 골라 둔다)
// 라디오 모양 · 글자 수 상태는 컴포넌트 테스트가, 여기서는 실제 4.3 요청 · 주소 · 이동을 본다.

const nextButton = (page: Page) => page.getByRole("button", { name: "다음: 면접관 선택" });
const group = (page: Page) => page.getByRole("main").getByRole("group", { name: "지원서" });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S03 지원서 선택 · 화면 (4.3)", () => {
  test("1단계 표시 · 제목과 4.3 지원서를 최근 작성순 라디오로 보여 주고, 처음에는 [다음]이 비활성이다", async ({
    page,
    msw,
  }) => {
    let query: string | undefined;
    msw.use(
      http.get(api("/applications"), ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json(APPLICATION_LIST);
      }),
    );
    await page.goto("/practice");
    const main = page.getByRole("main");

    const steps = main.getByRole("list", { name: "면접 준비 단계" }).getByRole("listitem");
    await expect(steps.filter({ hasText: "지원서" })).toHaveAttribute("aria-current", "step");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("어떤 면접을 준비하나요?");
    await expect(group(page).getByRole("radio")).toHaveCount(2);
    // 회사 · 직무와 작성일은 줄을 나눠 그리므로 사이 공백 여부에 기대지 않는다.
    await expect(group(page).getByRole("radio").first()).toHaveAccessibleName(
      /^○○전자 · 백엔드 개발자\s*2026\.10\.15$/,
    );
    await expect(group(page).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: "+ 추가하기" })).toHaveAttribute(
      "href",
      "/applications/new?from=practice",
    );
    await expect(main.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/home");
    await expect(nextButton(page)).toBeDisabled();
    expect(query).toBe("?page=0&size=20");
  });

  test("저장된 지원서가 없으면 안내와 [+ 추가하기]만 보인다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/applications"), () =>
        HttpResponse.json({
          content: [],
          page: { size: 20, number: 0, totalElements: 0, totalPages: 0 },
        }),
      ),
    );
    await page.goto("/practice");

    await expect(group(page).getByText("저장된 지원서가 없어요")).toBeVisible();
    await expect(group(page).getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "+ 추가하기" })).toBeVisible();
    await expect(nextButton(page)).toBeDisabled();
  });

  test("주소의 applicationId가 목록에 있으면 그 지원서를 골라 두고, 없으면 아무것도 고르지 않는다", async ({
    page,
  }) => {
    await page.goto("/practice?applicationId=9");
    await expect(group(page).getByRole("radio", { name: /△△소프트/ })).toBeChecked();
    await expect(nextButton(page)).toBeEnabled();

    await page.goto("/practice?applicationId=777");
    await expect(group(page).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(nextButton(page)).toBeDisabled();
  });

  test("막 저장한 표시(added=1)가 있어도 그 지원서가 목록에 없으면 아무것도 고르지 않는다", async ({
    page,
  }) => {
    await page.goto("/practice?applicationId=777&added=1");

    await expect(group(page).getByRole("radio")).toHaveCount(2);
    await expect(group(page).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(nextButton(page)).toBeDisabled();
  });
});

test.describe("S03 지원서 선택 · 이동", () => {
  test("지원서를 고르고 [다음]을 누르면 그 지원서 id를 들고 S04 면접관 선택으로 간다", async ({
    page,
  }) => {
    await page.goto("/practice");

    await group(page).getByText("△△소프트 · 서버 개발자").click();
    await expect(nextButton(page)).toBeEnabled();
    await nextButton(page).click();

    await expect(page).toHaveURL("/practice/interviewer?applicationId=9");
  });

  test("[+ 추가하기] → 지원서 쓰기에서 저장하면 S03로 돌아와 새 지원서를 골라 두고, 다시 들어가면 빈 폼이다", async ({
    page,
    msw,
  }) => {
    let created: ApplicationCreateRequest | undefined;
    msw.use(
      http.post(api("/applications"), async ({ request }) => {
        created = (await request.json()) as ApplicationCreateRequest;
        return HttpResponse.json(APPLICATION, { status: 201 });
      }),
      // 저장 뒤에는 새 지원서(id 10)가 맨 위에 있는 목록을 돌려준다(4.3 최근 작성순).
      http.get(api("/applications"), () =>
        HttpResponse.json({
          ...APPLICATION_LIST,
          content: created
            ? [
                {
                  id: APPLICATION.id,
                  companyName: APPLICATION.companyName,
                  jobTitle: APPLICATION.jobTitle,
                  createdAt: APPLICATION.createdAt,
                },
                ...APPLICATION_LIST.content,
              ]
            : APPLICATION_LIST.content,
        }),
      ),
    );
    await page.goto("/practice");
    await expect(group(page).getByRole("radio")).toHaveCount(2);

    await page.getByRole("link", { name: "+ 추가하기" }).click();
    await expect(page).toHaveURL("/applications/new?from=practice");
    await page.getByLabel("회사명").fill("○○전자");
    await page.getByLabel("직무").fill("백엔드 개발자");
    await page.getByLabel("문항 1", { exact: true }).fill("지원 동기");
    await page.getByLabel("문항 1 답변").fill("저는…");
    await page.getByRole("button", { name: "저장하기" }).click();

    await expect(page).toHaveURL(`/practice?applicationId=${APPLICATION.id}&added=1`);
    await expect(group(page).getByRole("radio", { checked: true })).toHaveAccessibleName(
      /^○○전자 · 백엔드 개발자/,
    );
    await expect(group(page).getByRole("radio", { checked: true })).toHaveValue(
      String(APPLICATION.id),
    );
    expect(created).toEqual({
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      coverLetterItems: [{ question: "지원 동기", answer: "저는…" }],
    } satisfies ApplicationCreateRequest);

    // 저장 뒤 기록을 바꿔치기해, 뒤로 가면 지원서 쓰기가 아니라 저장 전 S03로 간다(같은 지원서를 또 만들지 않게).
    await page.goBack();
    await expect(page).toHaveURL("/practice");
    // 저장 액션이 refresh로 BFCache를 비웠으므로, 저장 전에 본 S03가 아니라 새 지원서가 맨 위에 든 4.3을 다시 받는다.
    await expect(group(page).getByRole("radio")).toHaveCount(3);
    await expect(group(page).getByRole("radio").first()).toHaveValue(String(APPLICATION.id));
    await page.goForward();
    await expect(page).toHaveURL(`/practice?applicationId=${APPLICATION.id}&added=1`);

    // 한 번 본 화면은 상태가 남으므로(cacheComponents), 다시 [+ 추가하기]로 들어오면 지난 입력 없이 처음부터 쓴다.
    await page.getByRole("link", { name: "+ 추가하기" }).click();
    await expect(page).toHaveURL("/applications/new?from=practice");
    await expect(page.getByLabel("회사명")).toBeEmpty();
    await expect(page.getByLabel("문항 1 답변")).toBeEmpty();
  });

  test("[홈으로] → S02 홈", async ({ page }) => {
    await page.goto("/practice");
    await page.getByRole("link", { name: "홈으로" }).click();

    await expect(page).toHaveURL("/home");
  });
});
