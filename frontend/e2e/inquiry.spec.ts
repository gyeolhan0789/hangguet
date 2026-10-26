import type { Page } from "@playwright/test";

import type { InquiryMessage, InquiryResponse } from "../src/types/api";

import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// I01 · I01-B · I01-1 · I02 · I03 · I03-1 · I04 문의(회원 · 비회원)
// 근거: Figma I01 ~ I04(화이트 · 다크) · 기획 메모 I01 ~ I04 · C01(프로필 메뉴 [문의하기] → I02) · S00 로그인 전 헤더 [문의하기] → I04
//   · Swagger 9.1 ~ 9.5(비회원은 X-Inquiry-Password, 없는 문의 · 틀린 조회 비밀번호는 404 INQUIRY_NOT_FOUND)
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
      const body = (await request.json()) as { title: string; content: string };
      state.inquiry = {
        id: 7,
        title: body.title,
        status: "WAITING",
        createdAt: stamp,
        updatedAt: stamp,
        messages: [{ id: 21, authorType: "USER", content: body.content, createdAt: stamp }],
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
      const { content } = (await request.json()) as { content: string };
      const message: InquiryMessage = {
        id: 30 + inquiry.messages.length,
        authorType: "USER",
        content,
        createdAt: stamp,
      };
      state.inquiry = { ...inquiry, status: "WAITING", messages: [...inquiry.messages, message] };
      return HttpResponse.json(message, { status: 201 });
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

async function fillAndSend(page: Page, title: string, content: string) {
  await page.getByLabel("제목").fill(title);
  await page.getByLabel("내용").fill(content);
  await page.getByRole("button", { name: "문의 보내기" }).click();
}

async function writeGuestInquiry(page: Page) {
  await page.getByLabel("이메일").fill("a@ssafy.com");
  await page.getByLabel("조회 비밀번호").fill("1234");
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
    expect(server.seen.find((s) => s.method === "POST" && s.path === "/inquiries")).toMatchObject({
      body: {
        email: "a@ssafy.com",
        accessPassword: "1234",
        title: "비밀번호를 잊어버렸어요",
        content: "바꿔 주세요",
      },
      authorized: false,
    });
    expect(server.seen.find((s) => s.method === "GET" && s.path === "/inquiries/7")?.password).toBe(
      "1234",
    );

    // 조회 비밀번호는 메모리에만 있어 새로고침하면 I04부터 다시 한다
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "문의 확인" })).toBeVisible();
    await expect(page.getByLabel("문의번호")).toBeVisible();
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
