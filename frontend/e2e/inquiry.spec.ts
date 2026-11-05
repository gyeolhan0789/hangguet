import type { Page } from "@playwright/test";

import type { InquiryAttachment, InquiryMessage, InquiryResponse } from "../src/types/api";

import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// I01 · I01-B · I01-1 · I02 · I03 · I03-1 · I04 문의(회원 · 비회원)
// 근거: Figma I01 ~ I04(화이트 · 다크) · 기획 메모 I01 ~ I04 · C01(프로필 메뉴 [문의하기] → I02) · S00 로그인 전 헤더 [문의하기] → I04
//   · Swagger 9.1 ~ 9.5(비회원은 X-Inquiry-Password, 없는 문의 · 틀린 조회 비밀번호는 404 INQUIRY_NOT_FOUND)
//   · Swagger 9.11 사진 업로드 주소 → 브라우저가 S3에 PUT → 9.1 · 9.4 attachmentKeys · 9.3 attachments
// 칸별 문구 · 말풍선 순서 · 모달 동작은 컴포넌트 테스트가, 여기서는 진입점 · 서버 컴포넌트 · 서버 액션이 실제 API를
// 회원은 토큰으로, 비회원은 조회 비밀번호 헤더로 부르고 다시 그리는지 본다.

// Swagger 9.3 404 예시
const INQUIRY_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "문의를 찾을 수 없어요.",
  instance: "/api/v1/inquiries/7",
  code: "INQUIRY_NOT_FOUND",
};

interface Seen {
  method: string;
  /** `/api/v1` 뒤 경로 + 쿼리 */
  path: string;
  body: unknown;
  password: string | null;
  authorized: boolean;
}

/** 9.11이 주는 업로드 주소. 브라우저가 보내는 PUT은 테스트 브라우저에서 가로챈다 */
const S3 = "https://s3.test";

// 9.1 · 9.4로 받은 키를 9.3 사진(받는 주소)으로 바꾼다
const photosOf = (body: { attachmentKeys?: string[] }): InquiryAttachment[] =>
  (body.attachmentKeys ?? []).map((key, index) => ({ id: index + 1, url: `${S3}/${key}` }));

/**
 * 서버 상태를 흉내 낸다: 9.1로 만든 문의(id 7)를 9.2 · 9.3이 돌려주고, 9.4는 메시지를 더하며, 9.5는 종료한다.
 * accessPassword가 있으면 비회원 문의라 헤더가 맞을 때만 보여 준다. 다른 문의 id나 지운 문의(gone)는 404.
 * 요청은 seen에 실제 주소로 남겨 끝난 뒤 확인한다.
 */
function inquiryServer(accessPassword?: string) {
  const seen: Seen[] = [];
  const state: { inquiry: InquiryResponse | null; gone: boolean } = { inquiry: null, gone: false };
  const stamp = "2026-10-26T10:00:00+09:00";

  const record = async (request: Request) => {
    const url = new URL(request.url);
    seen.push({
      method: request.method,
      path: `${url.pathname.replace(/^.*\/api\/v1/, "")}${url.search}`,
      body:
        request.method === "POST"
          ? await request
              .clone()
              .json()
              .catch(() => null)
          : null,
      password: request.headers.get("X-Inquiry-Password"),
      authorized: request.headers.has("Authorization"),
    });
  };
  const found = (request: Request, id: unknown) =>
    state.inquiry !== null &&
    !state.gone &&
    id === String(state.inquiry.id) &&
    (accessPassword === undefined || request.headers.get("X-Inquiry-Password") === accessPassword);

  const handlers = [
    http.post(api("/inquiries"), async ({ request }) => {
      await record(request);
      const body = (await request.json()) as {
        title: string;
        content: string;
        attachmentKeys?: string[];
      };
      state.inquiry = {
        id: 7,
        title: body.title,
        status: "WAITING",
        createdAt: stamp,
        updatedAt: stamp,
        messages: [
          {
            id: 21,
            authorType: "USER",
            content: body.content,
            createdAt: stamp,
            attachments: photosOf(body),
          },
        ],
      };
      return HttpResponse.json(state.inquiry, { status: 201 });
    }),
    http.get(api("/inquiries"), async ({ request }) => {
      await record(request);
      const { inquiry } = state;
      const content = inquiry
        ? [
            {
              id: inquiry.id,
              title: inquiry.title,
              status: inquiry.status,
              createdAt: inquiry.createdAt,
              updatedAt: inquiry.updatedAt,
            },
          ]
        : [];
      return HttpResponse.json({
        content,
        page: { size: 10, number: 0, totalElements: content.length, totalPages: 1 },
      });
    }),
    http.get(api("/inquiries/:id"), async ({ request, params }) => {
      await record(request);
      return found(request, params.id)
        ? HttpResponse.json(state.inquiry)
        : problemResponse(INQUIRY_NOT_FOUND);
    }),
    http.post(api("/inquiries/:id/messages"), async ({ request, params }) => {
      await record(request);
      const { inquiry } = state;
      if (!found(request, params.id) || !inquiry) return problemResponse(INQUIRY_NOT_FOUND);
      const body = (await request.json()) as { content: string; attachmentKeys?: string[] };
      const message: InquiryMessage = {
        id: 30 + inquiry.messages.length,
        authorType: "USER",
        content: body.content,
        createdAt: stamp,
        attachments: photosOf(body),
      };
      state.inquiry = { ...inquiry, status: "WAITING", messages: [...inquiry.messages, message] };
      return HttpResponse.json(message, { status: 201 });
    }),
    http.post(api("/inquiries/attachments/upload-url"), async ({ request }) => {
      await record(request);
      const { files } = (await request.json()) as {
        files: { contentType: string; size: number }[];
      };
      // 키는 테스트가 고른 파일의 크기로 만든다(크기를 사진마다 다르게 준다)
      return HttpResponse.json({
        files: files.map((file) => {
          const extension = file.contentType === "image/png" ? "png" : "jpg";
          const objectKey = `inquiry/${file.size}.${extension}`;
          return { uploadUrl: `${S3}/upload/${objectKey}`, objectKey, expiresAt: stamp };
        }),
      });
    }),
    http.post(api("/inquiries/:id/close"), async ({ request, params }) => {
      await record(request);
      const { inquiry } = state;
      if (!found(request, params.id) || !inquiry) return problemResponse(INQUIRY_NOT_FOUND);
      state.inquiry = { ...inquiry, status: "CLOSED" };
      return new HttpResponse(null, { status: 204 });
    }),
  ];
  return { handlers, seen, state };
}

/** 크기(바이트)가 다른 사진. 9.11 흉내가 크기로 키를 만든다 */
const picture = (name: string, size: number, mimeType = "image/png") => ({
  name,
  mimeType,
  buffer: Buffer.alloc(size),
});

/** 브라우저가 S3로 보내는 PUT을 가로채 주소 · Content-Type을 남기고 status로 답한다 */
async function fakeS3(page: Page, status = 200) {
  const puts: { url: string; method: string; contentType?: string }[] = [];
  await page.route(`${S3}/upload/**`, async (route) => {
    puts.push({
      url: route.request().url(),
      method: route.request().method(),
      contentType: route.request().headers()["content-type"],
    });
    await route.fulfill({ status });
  });
  return puts;
}

async function fillAndSend(page: Page, title: string, content: string) {
  await page.getByLabel("제목").fill(title);
  await page.getByLabel("내용").fill(content);
  await page.getByRole("button", { name: "문의 보내기" }).click();
}

async function writeGuestInquiry(page: Page) {
  await page.getByLabel("이메일").fill("a@ssafy.com");
  await page.getByLabel("조회 비밀번호").fill("1234");
  await page.getByText("[필수] 개인정보 수집 · 이용 동의").click();
  await fillAndSend(page, "비밀번호를 잊어버렸어요", "바꿔 주세요");
}

const thread = (page: Page) => page.getByRole("list", { name: "주고받은 메시지" });

test.describe("회원 문의(I02 · I01 · I03)", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("프로필 메뉴 [문의하기] → I02 → I01로 남기면 토큰으로 9.1을 부르고 I03으로 가며, I02 줄로 다시 연다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer();
    msw.use(...server.handlers);
    await page.goto("/home");

    await page.getByRole("button", { name: "프로필 메뉴" }).click();
    await page.getByRole("menuitem", { name: "문의하기" }).click();
    await expect(page).toHaveURL("/inquiries");
    await page.getByRole("link", { name: "+ 문의하기" }).click();
    await expect(page).toHaveURL("/inquiries/new");
    await fillAndSend(page, "질문이 반복돼요", "확인해 주세요");

    await expect(page).toHaveURL("/inquiries/7");
    await expect(page.getByRole("heading", { level: 1, name: "질문이 반복돼요" })).toBeVisible();
    expect(server.seen.find((s) => s.method === "POST" && s.path === "/inquiries")).toMatchObject({
      body: { title: "질문이 반복돼요", content: "확인해 주세요" },
      authorized: true,
    });

    // '‹ 내 문의' → I02: 9.2(page 0 · size 10)로 그린 줄을 누르면 다시 I03
    await page.getByRole("link", { name: "내 문의" }).click();
    await expect(page).toHaveURL("/inquiries");
    const row = page.getByRole("list", { name: "내 문의" }).getByRole("link");
    await expect(row).toHaveText(/질문이 반복돼요.*답변 대기/);
    expect(
      server.seen.some((s) => s.method === "GET" && s.path === "/inquiries?page=0&size=10"),
    ).toBe(true);
    await row.click();
    await expect(page).toHaveURL("/inquiries/7");
  });

  // 사용자 결정(2026-11-05): 보낸 뒤 뒤로 가기로 보낸 폼에 돌아가지 않고(기록 바꿔치기), 다시 들어온 I01은 빈 폼이다.
  // Next.js는 본 화면을 숨겨 두었다가 다시 보여 주므로(Activity) 새로 들어올 때마다 새로 그린다.
  test("I01로 보낸 뒤 뒤로 가기는 I02로 가고, 다시 [+ 문의하기]로 들어가면 빈 폼이다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer();
    msw.use(...server.handlers);
    await page.goto("/inquiries");
    await page.getByRole("link", { name: "+ 문의하기" }).click();
    await expect(page).toHaveURL("/inquiries/new");
    await fillAndSend(page, "질문이 반복돼요", "확인해 주세요");
    await expect(page).toHaveURL("/inquiries/7");

    await page.goBack();
    await expect(page).toHaveURL("/inquiries");
    await page.getByRole("link", { name: "+ 문의하기" }).click();

    await expect(page).toHaveURL("/inquiries/new");
    await expect(page.getByLabel("제목")).toHaveValue("");
    await expect(page.getByLabel("내용")).toHaveValue("");
  });

  test("I01에서 사진을 올리지 못하면 9.1을 부르지 않고 문구를 보이며, 다시 보내면 사진을 붙여 남긴다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer();
    msw.use(...server.handlers);
    await fakeS3(page, 403);
    await page.goto("/inquiries/new");

    await page.getByRole("main").getByLabel("사진 파일").setInputFiles(picture("a.png", 3));
    await fillAndSend(page, "녹화가 안 돼요", "화면이 까매요");

    await expect(page.getByText("잠시 후 다시 시도해 주세요.")).toBeVisible();
    expect(server.seen.some((s) => s.method === "POST" && s.path === "/inquiries")).toBe(false);
    await expect(page.getByRole("img", { name: "고른 사진 1" })).toBeVisible();

    await page.unroute(`${S3}/upload/**`);
    await fakeS3(page);
    await page.getByRole("button", { name: "문의 보내기" }).click();

    await expect(page).toHaveURL("/inquiries/7");
    const created = server.seen.find((s) => s.method === "POST" && s.path === "/inquiries");
    expect(created?.body).toMatchObject({ attachmentKeys: ["inquiry/3.png"] });
    expect(created?.authorized).toBe(true);
  });

  test("I03에서 이어서 쓰고 종료하면 9.4 · 9.5 뒤 다시 그려 '종료한 문의예요.'만 남는다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer();
    msw.use(...server.handlers);
    await page.goto("/inquiries/new");
    await fillAndSend(page, "질문이 반복돼요", "확인해 주세요");
    await expect(page).toHaveURL("/inquiries/7");

    await page.getByLabel("이어서 쓰기").fill("하나 더 있어요");
    await page.getByRole("button", { name: "보내기" }).click();
    await expect(thread(page)).toContainText("하나 더 있어요");

    await page.getByRole("button", { name: "문의 종료" }).click();
    await page
      .getByRole("dialog", { name: "문의를 종료할까요?" })
      .getByRole("button", { name: "종료" })
      .click();

    await expect(page.getByText("종료한 문의예요.")).toBeVisible();
    await expect(page.getByLabel("이어서 쓰기")).toHaveCount(0);
    expect(
      server.seen
        .filter((s) => s.method === "POST" && s.path.startsWith("/inquiries/7/"))
        .map((s) => [s.path, s.password, s.authorized]),
    ).toEqual([
      ["/inquiries/7/messages", null, true],
      ["/inquiries/7/close", null, true],
    ]);
  });

  test("없거나 남의 문의(404)를 열면 I02로 간다", async ({ page, msw }) => {
    msw.use(...inquiryServer().handlers);
    await page.goto("/inquiries/7");

    await expect(page).toHaveURL("/inquiries");
  });

  test("로그인했으면 비회원 문의 화면(I04 · I01-B)에 들어오지 않는다", async ({ page }) => {
    await page.goto("/inquiries/guest");
    await expect(page).toHaveURL("/home");

    await page.goto("/inquiries/guest/new");
    await expect(page).toHaveURL("/home");
  });
});

test.describe("비회원 문의(I04 · I01-B · I01-1 · I03)", () => {
  test("헤더 [문의하기] → I04 → I01-B로 남기면 문의번호를 보여 주고, [확인]하면 조회 비밀번호로 그 문의를 연다. 새로고침하면 I04로", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer("1234");
    msw.use(...server.handlers);
    await page.goto("/");

    await page.getByRole("banner").getByRole("link", { name: "문의하기" }).click();
    await expect(page).toHaveURL("/inquiries/guest");
    await page.getByRole("link", { name: "+ 문의하기" }).click();
    await expect(page).toHaveURL("/inquiries/guest/new");
    await writeGuestInquiry(page);

    const done = page.getByRole("dialog", { name: "문의를 남겼어요" });
    await expect(done.getByText("7", { exact: true })).toBeVisible();
    await done.getByRole("button", { name: "확인" }).click();

    await expect(page).toHaveURL("/inquiries/guest");
    await expect(
      page.getByRole("heading", { level: 1, name: "비밀번호를 잊어버렸어요" }),
    ).toBeVisible();
    const created = server.seen.find((s) => s.method === "POST" && s.path === "/inquiries");
    expect(created?.authorized).toBe(false);
    // 개인정보 수집 · 이용 동의는 9.1이 받지 않아 보내지 않는다
    expect(created?.body).toEqual({
      email: "a@ssafy.com",
      accessPassword: "1234",
      title: "비밀번호를 잊어버렸어요",
      content: "바꿔 주세요",
    });
    expect(server.seen.find((s) => s.method === "GET" && s.path === "/inquiries/7")?.password).toBe(
      "1234",
    );

    // 조회 비밀번호는 메모리에만 있어 새로고침하면 I04부터 다시 한다
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "문의 확인" })).toBeVisible();
    await expect(page.getByLabel("문의번호")).toBeVisible();
  });

  // 사용자 결정(2026-11-05): Next.js는 본 화면을 숨겨 두었다가 다시 보여 주므로(Activity) 새로 들어올 때마다 새로 그린다.
  test("남긴 뒤 다시 [+ 문의하기]로 들어가면 지난 완료 창 없이 빈 폼이고, 두 번째로 남긴 문의도 [확인]하면 바로 연다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer("1234");
    msw.use(...server.handlers);
    await page.goto("/inquiries/guest");
    await page.getByRole("link", { name: "+ 문의하기" }).click();
    await writeGuestInquiry(page);
    await page
      .getByRole("dialog", { name: "문의를 남겼어요" })
      .getByRole("button", { name: "확인" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "비밀번호를 잊어버렸어요" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "내 문의" }).click();
    await page.getByRole("link", { name: "+ 문의하기" }).click();

    await expect(page).toHaveURL("/inquiries/guest/new");
    await expect(page.getByRole("dialog", { name: "문의를 남겼어요" })).toHaveCount(0);
    await expect(page.getByLabel("제목")).toHaveValue("");
    await page.getByLabel("이메일").fill("a@ssafy.com");
    await page.getByLabel("조회 비밀번호").fill("1234");
    await page.getByText("[필수] 개인정보 수집 · 이용 동의").click();
    await fillAndSend(page, "두 번째 문의예요", "다시 확인해 주세요");
    await page
      .getByRole("dialog", { name: "문의를 남겼어요" })
      .getByRole("button", { name: "확인" })
      .click();

    await expect(page.getByRole("heading", { level: 1, name: "두 번째 문의예요" })).toBeVisible();
  });

  test("I01-B: 개인정보 수집 · 이용에 동의하지 않으면 보내지 않고, [보기]는 동의 본문을 모달로 보여 준다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer("1234");
    msw.use(...server.handlers);
    await page.goto("/inquiries/guest/new");
    await page.getByLabel("이메일").fill("a@ssafy.com");
    await page.getByLabel("조회 비밀번호").fill("1234");
    await fillAndSend(page, "비밀번호를 잊어버렸어요", "바꿔 주세요");

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "개인정보 수집 · 이용에 동의해 주세요.",
    );
    expect(server.seen.some((s) => s.method === "POST")).toBe(false);

    await page.getByRole("button", { name: "비회원 문의 개인정보 수집 · 이용 동의 보기" }).click();
    const dialog = page.getByRole("dialog", { name: "비회원 문의 개인정보 수집 · 이용 동의" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "확인" }).click();
    await expect(dialog).toBeHidden();
  });

  test("I04: 틀린 조회 비밀번호(404)는 서버 문구, 맞으면 열고 이어서 쓰고 종료한 뒤 9.3을 다시 불러 보여 준다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer("1234");
    msw.use(...server.handlers);
    // 문의를 먼저 남겨 두고, 새로 들어온 것처럼 I04를 연다(새로 열면 메모리에 든 조회 비밀번호가 없다)
    await page.goto("/inquiries/guest/new");
    await writeGuestInquiry(page);
    await expect(page.getByRole("dialog", { name: "문의를 남겼어요" })).toBeVisible();
    await page.goto("/inquiries/guest");

    await page.getByLabel("문의번호").fill("7");
    await page.getByLabel("조회 비밀번호").fill("9999");
    await page.getByRole("button", { name: "확인" }).click();
    await expect(page.getByText("문의를 찾을 수 없어요.")).toBeVisible();

    await page.getByLabel("조회 비밀번호").fill("1234");
    await page.getByRole("button", { name: "확인" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "비밀번호를 잊어버렸어요" }),
    ).toBeVisible();

    await page.getByLabel("이어서 쓰기").fill("확인 부탁드려요");
    await page.getByRole("button", { name: "보내기" }).click();
    await expect(thread(page)).toContainText("확인 부탁드려요");

    await page.getByRole("button", { name: "문의 종료" }).click();
    await page
      .getByRole("dialog", { name: "문의를 종료할까요?" })
      .getByRole("button", { name: "종료" })
      .click();
    await expect(page.getByText("종료한 문의예요.")).toBeVisible();

    expect(
      server.seen
        .filter((s) => s.method === "POST" && s.path.startsWith("/inquiries/7/"))
        .map((s) => [s.path, s.password, s.authorized]),
    ).toEqual([
      ["/inquiries/7/messages", "1234", false],
      ["/inquiries/7/close", "1234", false],
    ]);
  });

  test("사진을 붙이면 9.11 → S3에 PUT → 9.1 attachmentKeys로 보내고, I03 말풍선 아래에 보여 준다. 이어서 쓸 때도 붙인다", async ({
    page,
    msw,
  }) => {
    const server = inquiryServer("1234");
    msw.use(...server.handlers);
    const s3 = await fakeS3(page);
    await page.goto("/inquiries/guest/new");

    await page
      .getByRole("main")
      .getByLabel("사진 파일")
      .setInputFiles([picture("a.png", 3), picture("b.jpg", 4, "image/jpeg")]);
    await expect(page.getByRole("img", { name: /고른 사진/ })).toHaveCount(2);
    await writeGuestInquiry(page);
    await page
      .getByRole("dialog", { name: "문의를 남겼어요" })
      .getByRole("button", { name: "확인" })
      .click();

    const uploadUrl = server.seen.find((s) => s.path === "/inquiries/attachments/upload-url");
    expect(uploadUrl?.body).toEqual({
      files: [
        { contentType: "image/png", size: 3 },
        { contentType: "image/jpeg", size: 4 },
      ],
    });
    // PUT은 동시에 보내므로 순서 대신 주소별로 본다: 사진마다 자기 주소로, 고른 형식으로 올린다
    expect(s3.every((put) => put.method === "PUT")).toBe(true);
    expect(Object.fromEntries(s3.map((put) => [put.url, put.contentType]))).toEqual({
      [`${S3}/upload/inquiry/3.png`]: "image/png",
      [`${S3}/upload/inquiry/4.jpg`]: "image/jpeg",
    });
    const created = server.seen.find((s) => s.method === "POST" && s.path === "/inquiries");
    expect(created?.body).toMatchObject({ attachmentKeys: ["inquiry/3.png", "inquiry/4.jpg"] });
    const photos = thread(page).getByRole("list", { name: "붙인 사진" }).getByRole("link");
    await expect(photos).toHaveCount(2);
    await expect(photos.first()).toHaveAttribute("href", `${S3}/inquiry/3.png`);

    await page.getByRole("main").getByLabel("사진 파일").setInputFiles(picture("c.png", 5));
    await page.getByLabel("이어서 쓰기").fill("하나 더요");
    await page.getByRole("button", { name: "보내기" }).click();

    await expect(thread(page).getByRole("list", { name: "붙인 사진" })).toHaveCount(2);
    const added = server.seen.find(
      (s) => s.method === "POST" && s.path === "/inquiries/7/messages",
    );
    expect(added?.body).toMatchObject({
      content: "하나 더요",
      attachmentKeys: ["inquiry/5.png"],
    });
    expect(added?.password).toBe("1234");
  });

  test("I03에서 쓰는 사이 문의가 없어지면(404) I04로 돌아간다", async ({ page, msw }) => {
    const server = inquiryServer("1234");
    msw.use(...server.handlers);
    await page.goto("/inquiries/guest/new");
    await writeGuestInquiry(page);
    await page
      .getByRole("dialog", { name: "문의를 남겼어요" })
      .getByRole("button", { name: "확인" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "비밀번호를 잊어버렸어요" }),
    ).toBeVisible();

    server.state.gone = true;
    await page.getByLabel("이어서 쓰기").fill("아직 있나요");
    await page.getByRole("button", { name: "보내기" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "문의 확인" })).toBeVisible();
  });
});
