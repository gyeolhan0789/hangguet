// 기준: Figma I01 ~ I04(화이트 · 다크) · 기획 메모 I01 ~ I04(I02는 회원만 · 최근 작성순 · 한 줄 = 제목 · 상태 · 작성일, I03 없는 문의는
//   회원이면 I02로, 비회원 조회 비밀번호는 화면을 떠나면 잊는다) · Swagger 9.1 ~ 9.3 · 9.11(비회원은 X-Inquiry-Password, 없는 문의 ·
//   틀린 조회 비밀번호는 404 INQUIRY_NOT_FOUND, 사진은 9.11 주소로 브라우저가 S3에 PUT한 뒤 9.1 attachmentKeys → 9.3 attachments)
// 칸별 문구 · 동의 · 말풍선 · 사진 고르기 · 이어서 쓰기 · 종료는 컴포넌트 테스트가, 여기서는 서버 컴포넌트의 주소(page · 문의 id) 해석 ·
// 조회 실패 분기, 브라우저 → S3 업로드 뒤 상세로 가는 흐름을 본다.
import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import type {
  AttachmentUploadUrlRequest,
  InquiryCreateRequest,
  InquiryListItem,
  InquiryResponse,
} from "../src/types/api";

import { PROBLEM } from "./mocks/data";
import { api, expect, http, HttpResponse, hydrated, problemResponse, test } from "./test";

/** Swagger 9.2 page의 최댓값(int32) */
const MAX_PAGE = 2_147_483_647;
/** 9.11이 주는 업로드 · 받는 주소의 호스트. 브라우저가 보내는 PUT은 테스트 브라우저에서 가로챈다 */
const S3 = "https://s3.test";
/** 테스트가 만드는 문의의 작성 · 수정 일시 */
const STAMP = "2026-10-26T10:00:00+09:00";

const main = (page: Page) => page.getByRole("main");
const heading = (page: Page, name: string) =>
  main(page).getByRole("heading", { level: 1, name, exact: true });
const rows = (page: Page) => main(page).getByRole("list", { name: "내 문의" }).getByRole("link");
const pageCount = (page: Page, text: string) => main(page).getByText(text, { exact: true });
const pagerLink = (page: Page, name: "이전 페이지" | "다음 페이지") =>
  main(page).getByRole("link", { name });

/**
 * 문의 서버 흉내: 9.1로 만든 문의(id 7)를 9.3이 돌려준다. accessPassword가 있으면 비회원 문의라 X-Inquiry-Password가 맞을 때만
 * 보여 준다(헤더는 응답을 고르는 데만 쓴다). 그 밖의 문의 id는 404.
 * 올린 사진 상태: S3가 PUT으로 받은 키만 9.1이 받고(실제 BE처럼 받지 않은 키가 있으면 404 FILE_NOT_FOUND), 그 키를 9.3 사진으로 돌려준다.
 * 9.11은 고른 파일의 크기로 키를 만든다.
 */
async function inquiryServer(page: Page, msw: MswFixture, accessPassword?: string) {
  const uploaded = new Set<string>();
  let inquiry: InquiryResponse | null = null;

  await page.route(`${S3}/upload/**`, async (route) => {
    if (route.request().method() === "PUT") {
      uploaded.add(new URL(route.request().url()).pathname.replace(/^\/upload\//, ""));
    }
    await route.fulfill({ status: 200 });
  });
  msw.use(
    http.post(api("/inquiries/attachments/upload-url"), async ({ request }) => {
      const { files } = (await request.json()) as AttachmentUploadUrlRequest;
      return HttpResponse.json({
        files: files.map((file) => {
          const extension = file.contentType === "image/png" ? "png" : "jpg";
          const objectKey = `inquiry/${file.size}.${extension}`;
          return { uploadUrl: `${S3}/upload/${objectKey}`, objectKey, expiresAt: STAMP };
        }),
      });
    }),
    http.post(api("/inquiries"), async ({ request }) => {
      const body = (await request.json()) as InquiryCreateRequest;
      const keys = body.attachmentKeys ?? [];
      if (keys.some((key) => !uploaded.has(key))) {
        return problemResponse({ ...PROBLEM.FILE_NOT_FOUND, instance: "/api/v1/inquiries" });
      }
      inquiry = {
        id: 7,
        title: body.title,
        status: "WAITING",
        createdAt: STAMP,
        updatedAt: STAMP,
        messages: [
          {
            id: 21,
            authorType: "USER",
            content: body.content,
            createdAt: STAMP,
            attachments: keys.map((key, index) => ({ id: index + 1, url: `${S3}/${key}` })),
          },
        ],
      };
      return HttpResponse.json(inquiry, { status: 201 });
    }),
    http.get(api("/inquiries/:inquiryId"), ({ request, params }) => {
      const opened =
        inquiry !== null &&
        params.inquiryId === String(inquiry.id) &&
        (accessPassword === undefined ||
          request.headers.get("X-Inquiry-Password") === accessPassword);
      return opened ? HttpResponse.json(inquiry) : problemResponse(PROBLEM.INQUIRY_NOT_FOUND);
    }),
  );
}

/** 9.2: totalPages쪽까지 쪽마다 '문의 {쪽}쪽' 한 줄을 주고, 범위 밖 쪽은 빈 목록으로 답하는 서버 흉내(0이면 문의 없음) */
function inquiryPages(msw: MswFixture, totalPages: number) {
  msw.use(
    http.get(api("/inquiries"), ({ request }) => {
      const number = Number(new URL(request.url).searchParams.get("page") ?? "0");
      const content: InquiryListItem[] =
        number < totalPages
          ? [
              {
                id: number + 1,
                title: `문의 ${number + 1}쪽`,
                status: "WAITING",
                createdAt: STAMP,
                updatedAt: STAMP,
              },
            ]
          : [];
      return HttpResponse.json({
        content,
        page: { size: 10, number, totalElements: totalPages, totalPages },
      });
    }),
  );
}

/** 제목 · 내용을 쓰고 [문의 보내기]를 누른다 */
async function fillAndSend(page: Page, title: string, content: string) {
  const fields = [
    [main(page).getByLabel("제목"), title],
    [main(page).getByLabel("내용"), content],
  ] as const;
  for (const [field, value] of fields) {
    await hydrated(field);
    await field.fill(value);
  }
  const send = main(page).getByRole("button", { name: "문의 보내기" });
  await hydrated(send);
  await send.click();
}

test.describe("I02 · 내 문의", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test.describe("화면 표시", () => {
    test("문의가 없으면 목록 없이 쪽 표시 '1 / 1'만 보여 준다", async ({ page, msw }) => {
      inquiryPages(msw, 0);
      await page.goto("/inquiries");

      await expect(pageCount(page, "1 / 1")).toBeVisible();
      await expect(main(page).getByRole("list", { name: "내 문의" })).toHaveCount(0);
      await expect(pagerLink(page, "이전 페이지")).toHaveCount(0);
      await expect(pagerLink(page, "다음 페이지")).toHaveCount(0);
    });
  });

  test.describe("사용자 조작", () => {
    test("[다음 페이지]를 누르면 다음 쪽 주소로 가 그 쪽 문의를 보여 준다", async ({
      page,
      msw,
    }) => {
      inquiryPages(msw, 3);
      await page.goto("/inquiries");
      const next = pagerLink(page, "다음 페이지");
      await hydrated(next);

      await next.click();

      await expect(page).toHaveURL("/inquiries?page=1");
      await expect(pageCount(page, "2 / 3")).toBeVisible();
      await expect(rows(page)).toHaveText(/문의 2쪽/);
    });
  });

  test.describe("입력 검증", () => {
    // page가 0 이상의 int32 정수 문자열 하나가 아니면 0으로 본다(배열 · 정규식 불일치 · int32 초과).
    for (const [label, query] of [
      ["배열 page=1&page=2", "page=1&page=2"],
      ["숫자 아님 page=abc", "page=abc"],
      ["int32 초과 page=2147483648", `page=${MAX_PAGE + 1}`],
    ]) {
      test(`주소의 page가 '${label}'이면 첫 쪽을 보여 준다`, async ({ page, msw }) => {
        inquiryPages(msw, 3);
        await page.goto(`/inquiries?${query}`);

        await expect(pageCount(page, "1 / 3")).toBeVisible();
        await expect(rows(page)).toHaveText(/문의 1쪽/);
      });
    }
  });

  test.describe("경계값", () => {
    test("첫 쪽이면 [이전 페이지] 없이 [다음 페이지]만 둔다", async ({ page, msw }) => {
      inquiryPages(msw, 3);
      await page.goto("/inquiries");

      await expect(pagerLink(page, "다음 페이지")).toBeVisible();
      await expect(pagerLink(page, "이전 페이지")).toHaveCount(0);
    });

    test("마지막 쪽이면 [다음 페이지]를 두지 않는다", async ({ page, msw }) => {
      inquiryPages(msw, 3);
      await page.goto("/inquiries?page=2");

      await expect(pageCount(page, "3 / 3")).toBeVisible();
      await expect(pagerLink(page, "이전 페이지")).toBeVisible();
      await expect(pagerLink(page, "다음 페이지")).toHaveCount(0);
    });

    test("주소의 page가 int32 최댓값이면 그 쪽으로 읽는다", async ({ page, msw }) => {
      inquiryPages(msw, 3);
      await page.goto(`/inquiries?page=${MAX_PAGE}`);

      await expect(pageCount(page, `${MAX_PAGE + 1} / 3`)).toBeVisible();
    });
  });
});

test.describe("I01 · 문의하기(회원)", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test.describe("사용자 조작", () => {
    test("사진을 붙여 남기면 만든 문의 상세(I03)로 가 말풍선 아래에 그 사진을 보여 준다", async ({
      page,
      msw,
    }) => {
      await inquiryServer(page, msw);
      await page.goto("/inquiries/new");
      const files = main(page).getByLabel("사진 파일");
      await hydrated(files);

      // 크기 3바이트 PNG. 9.11 흉내가 크기로 키(inquiry/3.png)를 만든다
      await files.setInputFiles({ name: "a.png", mimeType: "image/png", buffer: Buffer.alloc(3) });
      await fillAndSend(page, "녹화가 안 돼요", "화면이 까매요");

      await expect(page).toHaveURL("/inquiries/7");
      await expect(heading(page, "녹화가 안 돼요")).toBeVisible();
      const photos = main(page)
        .getByRole("list", { name: "주고받은 메시지" })
        .getByRole("list", { name: "붙인 사진" })
        .getByRole("link");
      await expect(photos).toHaveCount(1);
      await expect(photos).toHaveAttribute("href", `${S3}/inquiry/3.png`);
    });
  });
});

test.describe("I03 · 문의 상세(회원)", () => {
  test.beforeEach(async ({ signIn, msw }) => {
    await signIn();
    inquiryPages(msw, 0);
  });

  test.describe("입력 검증", () => {
    test("주소의 문의 id가 양의 정수가 아니면 내 문의 목록(I02)으로 보낸다", async ({ page }) => {
      await page.goto("/inquiries/abc");

      await expect(page).toHaveURL("/inquiries");
    });
  });

  test.describe("오류 처리", () => {
    test("조회가 404(INQUIRY_NOT_FOUND)면 내 문의 목록(I02)으로 보낸다", async ({ page, msw }) => {
      await inquiryServer(page, msw);
      await page.goto("/inquiries/7");

      await expect(page).toHaveURL("/inquiries");
    });

    test("조회가 404가 아닌 실패(500)면 오류 화면을 보여 준다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/inquiries/:inquiryId"), () => problemResponse(PROBLEM.INTERNAL_ERROR)),
      );
      await page.goto("/inquiries/7");

      await expect(heading(page, "화면을 불러오지 못했어요")).toBeVisible();
    });
  });
});
