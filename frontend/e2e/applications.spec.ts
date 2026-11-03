import type { Page } from "@playwright/test";

import type { ApplicationCreateRequest } from "../src/types/api";

import {
  APPLICATION,
  APPLICATION_LIST,
  APPLICATION_NO_SESSIONS,
  APPLICATION_SESSIONS,
  COMPANIES,
  PROBLEM,
} from "./mocks/data";
import { api, expect, http, HttpResponse, hydrated, problemResponse, test } from "./test";

// 지원 관리 목록 · 상세 · 삭제 확인 · 지원서 쓰기
// 근거: Figma 지원 관리 · 목록 · 상세 · 상세 · 면접에 씀 · 삭제 확인 · 지원서 쓰기(화이트 · 다크) · 기획 메모 지원 관리 · 지원서 쓰기
//   · Swagger 4.1 지원서 작성(coverLetterItems) · 4.2 지원서 조회 · 4.3 지원서 목록 · 4.5 지원서 삭제 · 4.6 지원서의 연습 면접 목록
//   · 4.7 회사 목록 · 사용자 결정(2026-11-03: 회사명 자동 완성, 목록을 못 불러오면 일반 입력칸)
//   · 사용자 결정(2026-10-29: 수정 기능 없음, 면접에 쓴 지원서도 지우고 실패하면 모달에 서버 문구, 204 · 404면 목록으로,
//   [이 지원서로 면접 보기] → S04, 저장 뒤 지원 관리에서 열었으면 새 지원서 상세로, 면접 기록이 한 쪽을 넘으면 '‹ 1 / N ›')
// 문항 추가 · 빼기 · 글자 수 · 모달 버튼 상태는 컴포넌트 테스트가, 여기서는 실제 API 요청 · 서버 컴포넌트 · 주소 이동을 본다.

const main = (page: Page) => page.getByRole("main");
const list = (page: Page) => main(page).getByRole("list", { name: "지원서" });

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

// 사용자 결정(2026-10-29): 헤더 프로필 메뉴(C01) · 모바일 메뉴에서도 지원 관리로 들어간다.
test.describe("지원 관리 · 들어오는 곳", () => {
  test("헤더 프로필 메뉴 [지원 관리]를 누르면 목록으로 가고 메뉴가 닫힌다", async ({ page }) => {
    await page.goto("/home");

    await page.getByRole("button", { name: "프로필 메뉴" }).click();
    await page.getByRole("menuitem", { name: "지원 관리" }).click();

    await expect(page).toHaveURL("/applications");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

test.describe("지원 관리 · 목록 (4.3)", () => {
  test("제목과 [+ 지원서 쓰기], 4.3 지원서를 최근 작성순으로 '회사 · 직무'와 작성일로 보여 준다", async ({
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
    await page.goto("/applications");

    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("지원 관리");
    await expect(main(page).getByRole("link", { name: "+ 지원서 쓰기" })).toHaveAttribute(
      "href",
      "/applications/new",
    );
    const rows = list(page).getByRole("link");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("○○전자 · 백엔드 개발자");
    await expect(rows.nth(0)).toContainText("2026.10.15");
    await expect(rows.nth(1)).toContainText("△△소프트 · 서버 개발자");
    await expect(rows.nth(1)).toContainText("2026.10.11");
    await expect(main(page).getByRole("navigation", { name: "페이지" })).toContainText("1 / 1");
    expect(query).toBe("?page=0&size=10");
  });

  test("줄을 누르면 그 지원서 상세로 간다", async ({ page }) => {
    await page.goto("/applications");

    await list(page)
      .getByRole("link", { name: /△△소프트/ })
      .click();

    await expect(page).toHaveURL("/applications/9");
  });

  test("다음 페이지가 있으면 '›'로 넘기고, 넘긴 페이지(page)로 4.3을 다시 부른다", async ({
    page,
    msw,
  }) => {
    const queries: string[] = [];
    msw.use(
      http.get(api("/applications"), ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        return HttpResponse.json({
          ...APPLICATION_LIST,
          page: {
            size: 10,
            number: Number(url.searchParams.get("page")),
            totalElements: 12,
            totalPages: 2,
          },
        });
      }),
    );
    await page.goto("/applications");

    await main(page).getByRole("link", { name: "다음 페이지" }).click();

    await expect(page).toHaveURL("/applications?page=1");
    await expect(main(page).getByRole("navigation", { name: "페이지" })).toContainText("2 / 2");
    await expect(main(page).getByRole("link", { name: "이전 페이지" })).toHaveAttribute(
      "href",
      "/applications",
    );
    expect(queries).toContain("?page=1&size=10");
  });

  for (const page of ["abc", "-1", "99999999999"]) {
    test(`주소의 page가 0 이상의 int32가 아니면(${page}) 첫 페이지로 4.3을 부른다`, async ({
      page: browser,
      msw,
    }) => {
      let query: string | undefined;
      msw.use(
        http.get(api("/applications"), ({ request }) => {
          query = new URL(request.url).search;
          return HttpResponse.json(APPLICATION_LIST);
        }),
      );
      await browser.goto(`/applications?page=${page}`);

      await expect(main(browser).getByRole("navigation", { name: "페이지" })).toContainText(
        "1 / 1",
      );
      expect(query).toBe("?page=0&size=10");
    });
  }

  test("지원서가 없으면 목록 상자 없이 페이지 표시만 있다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/applications"), () =>
        HttpResponse.json({
          content: [],
          page: { size: 10, number: 0, totalElements: 0, totalPages: 0 },
        }),
      ),
    );
    await page.goto("/applications");

    await expect(main(page).getByRole("navigation", { name: "페이지" })).toContainText("1 / 1");
    await expect(list(page)).toHaveCount(0);
  });
});

test.describe("지원 관리 · 상세 (4.2 · 4.6)", () => {
  test("주소의 지원서를 4.2로 불러 제목 · 작성일 · 문항을 순서대로 보여 주고, 면접이 없으면 '0회'와 빈 안내를 보여 준다", async ({
    page,
    msw,
  }) => {
    let requested: string | undefined;
    let sessionsQuery: string | undefined;
    msw.use(
      http.get(api("/applications/:applicationId"), ({ params }) => {
        requested = String(params.applicationId);
        return HttpResponse.json(APPLICATION);
      }),
      http.get(api("/applications/:applicationId/interview-sessions"), ({ params, request }) => {
        sessionsQuery = `${String(params.applicationId)}${new URL(request.url).search}`;
        return HttpResponse.json(APPLICATION_NO_SESSIONS);
      }),
    );
    await page.goto("/applications/10");

    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText(
      "○○전자 · 백엔드 개발자",
    );
    await expect(main(page).getByText("2026.10.15 작성")).toBeVisible();
    const coverLetter = main(page).getByRole("region", { name: "자기소개서" });
    await expect(coverLetter.getByRole("listitem")).toHaveText(
      APPLICATION.coverLetterItems.map(
        ({ itemOrder, question, answer }) => `Q${itemOrder}${question}${answer}`,
      ),
    );
    const records = main(page).getByRole("region", { name: "면접 기록" });
    await expect(records.getByText("0회")).toBeVisible();
    await expect(records.getByText("아직 이 지원서로 본 면접이 없어요")).toBeVisible();
    await expect(records.getByRole("navigation")).toHaveCount(0);
    expect(requested).toBe("10");
    expect(sessionsQuery).toBe("10?page=0&size=10");
  });

  test("이 지원서로 본 면접을 4.6으로 불러 횟수와 줄을 보여 주고, 줄의 [상세 피드백] · [다시보기]로 그 면접의 결과 · 다시보기에 간다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/applications/:applicationId/interview-sessions"), () =>
        HttpResponse.json(APPLICATION_SESSIONS),
      ),
    );
    await page.goto("/applications/12");

    const records = main(page).getByRole("region", { name: "면접 기록" });
    await expect(records.getByText("2회")).toBeVisible();
    const rows = records.getByRole("article");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAccessibleName("10.21 · 악마 면접관 · 화상");
    await expect(rows.nth(0)).toContainText("논리는 탄탄했지만, 근거가 조금 아쉬웠어요");
    await expect(rows.nth(1)).toHaveAccessibleName("10.20 · 악마 면접관 · 채팅");
    await expect(rows.nth(1).getByRole("link", { name: "다시보기" })).toHaveAttribute(
      "href",
      "/interview/52/replay",
    );

    await rows.nth(0).getByRole("link", { name: "상세 피드백" }).click();

    await expect(page).toHaveURL("/interview/55/result");
  });

  test("면접 기록이 한 쪽을 넘으면 '›'로 넘기고, 넘긴 쪽(page)으로 4.6을 다시 부른다", async ({
    page,
    msw,
  }) => {
    const queries: string[] = [];
    msw.use(
      http.get(api("/applications/:applicationId/interview-sessions"), ({ request }) => {
        const url = new URL(request.url);
        queries.push(url.search);
        return HttpResponse.json({
          ...APPLICATION_SESSIONS,
          page: {
            size: 10,
            number: Number(url.searchParams.get("page")),
            totalElements: 12,
            totalPages: 2,
          },
        });
      }),
    );
    // 쪽 넘김 주소는 4.2가 돌려준 지원서 id로 만든다(기본 핸들러는 APPLICATION).
    await page.goto(`/applications/${APPLICATION.id}`);
    const records = main(page).getByRole("region", { name: "면접 기록" });
    await expect(records.getByText("12회")).toBeVisible();

    await records.getByRole("link", { name: "다음 페이지" }).click();

    await expect(page).toHaveURL(`/applications/${APPLICATION.id}?page=1`);
    await expect(records.getByRole("navigation", { name: "페이지" })).toContainText("2 / 2");
    await expect(records.getByRole("link", { name: "이전 페이지" })).toHaveAttribute(
      "href",
      `/applications/${APPLICATION.id}`,
    );
    expect(queries).toContain("?page=1&size=10");
  });

  test("면접 기록 쪽수를 넘은 주소(page)면 첫 쪽으로 바꿔 연다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/applications/:applicationId/interview-sessions"), ({ request }) => {
        const number = Number(new URL(request.url).searchParams.get("page"));
        return HttpResponse.json(
          number === 0
            ? APPLICATION_SESSIONS
            : { content: [], page: { size: 10, number, totalElements: 2, totalPages: 1 } },
        );
      }),
    );
    await page.goto("/applications/12?page=5");

    await expect(page).toHaveURL("/applications/12");
    await expect(
      main(page).getByRole("region", { name: "면접 기록" }).getByRole("article"),
    ).toHaveCount(2);
  });

  test("[이 지원서로 면접 보기]를 누르면 그 지원서로 S04 면접관 선택에 간다", async ({ page }) => {
    await page.goto("/applications/10");

    await page.getByRole("link", { name: "이 지원서로 면접 보기" }).click();

    await expect(page).toHaveURL("/practice/interviewer?applicationId=10");
  });

  test("'‹ 지원 관리'를 누르면 목록으로 돌아간다", async ({ page }) => {
    await page.goto("/applications/10");

    await main(page).getByRole("link", { name: "지원 관리" }).click();

    await expect(page).toHaveURL("/applications");
  });

  for (const [name, path] of [
    ["4.2", "/applications/:applicationId"],
    ["4.6", "/applications/:applicationId/interview-sessions"],
  ]) {
    test(`${name}가 없는 지원서(404 APPLICATION_NOT_FOUND)라고 하면 목록으로 보낸다`, async ({
      page,
      msw,
    }) => {
      msw.use(http.get(api(path), () => problemResponse(PROBLEM.APPLICATION_NOT_FOUND)));
      await page.goto("/applications/10");

      await expect(page).toHaveURL("/applications");
    });
  }

  for (const value of ["abc", "-1", "99999999999"]) {
    test(`주소의 page가 0 이상의 int32가 아니면(${value}) 면접 기록 첫 쪽으로 4.6을 부른다`, async ({
      page,
      msw,
    }) => {
      let query: string | undefined;
      msw.use(
        http.get(api("/applications/:applicationId/interview-sessions"), ({ request }) => {
          query = new URL(request.url).search;
          return HttpResponse.json(APPLICATION_SESSIONS);
        }),
      );
      await page.goto(`/applications/12?page=${value}`);

      await expect(
        main(page).getByRole("region", { name: "면접 기록" }).getByRole("article"),
      ).toHaveCount(2);
      expect(query).toBe("?page=0&size=10");
    });
  }

  test("주소의 지원서 id 형식이 틀리면 목록으로 보낸다", async ({ page }) => {
    await page.goto("/applications/abc");

    await expect(page).toHaveURL("/applications");
  });
});

test.describe("지원 관리 · 삭제 확인 (4.5)", () => {
  test("[삭제] → 모달 [삭제]를 누르면 그 지원서를 4.5로 지우고 목록으로 간다", async ({
    page,
    msw,
  }) => {
    let deleted: string | undefined;
    msw.use(
      http.delete(api("/applications/:applicationId"), ({ params }) => {
        deleted = String(params.applicationId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto("/applications/10");

    await main(page).getByRole("button", { name: "삭제" }).click();
    const dialog = page.getByRole("dialog", { name: "지원서를 삭제할까요?" });
    await expect(dialog).toContainText("삭제하면 되돌릴 수 없어요");
    await dialog.getByRole("button", { name: "삭제" }).click();

    await expect(page).toHaveURL("/applications");
    expect(deleted).toBe("10");
  });

  test("목록 → 상세에서 지우면 지운 줄이 빠진 목록으로 가고, 뒤로 가도 지운 지원서 상세로 돌아가지 않는다", async ({
    page,
    msw,
  }) => {
    let deletedId: number | undefined;
    msw.use(
      http.get(api("/applications"), () =>
        HttpResponse.json({
          ...APPLICATION_LIST,
          content: APPLICATION_LIST.content.filter((item) => item.id !== deletedId),
        }),
      ),
      // 4.2는 주소의 지원서를 돌려준다(누른 줄의 id로 지우는지 확인하기 위해).
      http.get(api("/applications/:applicationId"), ({ params }) =>
        HttpResponse.json({ ...APPLICATION, id: Number(params.applicationId) }),
      ),
      http.delete(api("/applications/:applicationId"), ({ params }) => {
        deletedId = Number(params.applicationId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto("/mypage");
    await main(page)
      .getByRole("link", { name: /지원 관리/ })
      .click();
    await list(page)
      .getByRole("link", { name: /○○전자/ })
      .click();
    await expect(page).toHaveURL("/applications/12");

    await main(page).getByRole("button", { name: "삭제" }).click();
    await page
      .getByRole("dialog", { name: "지원서를 삭제할까요?" })
      .getByRole("button", { name: "삭제" })
      .click();

    await expect(page).toHaveURL("/applications");
    await expect(list(page).getByRole("link")).toHaveCount(1);
    expect(deletedId).toBe(12);

    // 기록을 바꿔치기했으므로 뒤로 가면 지운 지원서 상세가 아니라 그 앞의 목록으로 간다.
    await page.goBack();
    await expect(page).toHaveURL("/applications");
    await expect(list(page).getByRole("link")).toHaveCount(1);
  });

  test("면접에 쓴 지원서도 지울 수 있다(4.5 204)", async ({ page, msw }) => {
    let deleted: string | undefined;
    msw.use(
      http.get(api("/applications/:applicationId/interview-sessions"), () =>
        HttpResponse.json(APPLICATION_SESSIONS),
      ),
      http.delete(api("/applications/:applicationId"), ({ params }) => {
        deleted = String(params.applicationId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto(`/applications/${APPLICATION.id}`);
    await expect(
      main(page).getByRole("region", { name: "면접 기록" }).getByText("2회"),
    ).toBeVisible();

    await main(page).getByRole("button", { name: "삭제" }).click();
    await page
      .getByRole("dialog", { name: "지원서를 삭제할까요?" })
      .getByRole("button", { name: "삭제" })
      .click();

    await expect(page).toHaveURL("/applications");
    expect(deleted).toBe(String(APPLICATION.id));
  });

  test("서버가 삭제에 실패하면(500 INTERNAL_ERROR) 모달 안에 서버 문구를 보여 주고 그대로 둔다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.delete(api("/applications/:applicationId"), () =>
        problemResponse(PROBLEM.INTERNAL_ERROR),
      ),
    );
    await page.goto("/applications/9");

    await main(page).getByRole("button", { name: "삭제" }).click();
    const dialog = page.getByRole("dialog", { name: "지원서를 삭제할까요?" });
    await dialog.getByRole("button", { name: "삭제" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(PROBLEM.INTERNAL_ERROR.detail);
    await expect(page).toHaveURL("/applications/9");
  });

  test("이미 지워진 지원서(404)면 목록으로 간다", async ({ page, msw }) => {
    msw.use(
      http.delete(api("/applications/:applicationId"), () =>
        problemResponse(PROBLEM.APPLICATION_NOT_FOUND),
      ),
    );
    await page.goto("/applications/10");

    await main(page).getByRole("button", { name: "삭제" }).click();
    await page
      .getByRole("dialog", { name: "지원서를 삭제할까요?" })
      .getByRole("button", { name: "삭제" })
      .click();

    await expect(page).toHaveURL("/applications");
  });
});

test.describe("지원서 쓰기 (4.1)", () => {
  test("지원 관리 [+ 지원서 쓰기]로 열어 저장하면 문항을 적은 순서대로 보내고 새 지원서 상세로 가며, 뒤로 가면 새 지원서가 든 목록이다", async ({
    page,
    msw,
  }) => {
    let body: ApplicationCreateRequest | undefined;
    msw.use(
      http.post(api("/applications"), async ({ request }) => {
        body = (await request.json()) as ApplicationCreateRequest;
        return HttpResponse.json(APPLICATION, { status: 201 });
      }),
      // 저장 뒤에는 새 지원서(id 10)가 맨 위에 있는 목록을 돌려준다(4.3 최근 작성순).
      http.get(api("/applications"), () =>
        HttpResponse.json(
          body
            ? {
                content: [
                  {
                    id: APPLICATION.id,
                    companyName: APPLICATION.companyName,
                    jobTitle: APPLICATION.jobTitle,
                    createdAt: APPLICATION.createdAt,
                  },
                  ...APPLICATION_LIST.content,
                ],
                page: {
                  ...APPLICATION_LIST.page,
                  totalElements: APPLICATION_LIST.page.totalElements + 1,
                },
              }
            : APPLICATION_LIST,
        ),
      ),
    );
    await page.goto("/applications");
    await expect(list(page).getByRole("link")).toHaveCount(2);
    await main(page).getByRole("link", { name: "+ 지원서 쓰기" }).click();
    await expect(page).toHaveURL("/applications/new");

    await page.getByLabel("회사명").fill(" ○○전자 ");
    await page.getByLabel("직무").fill("백엔드 개발자");
    await page.getByLabel("문항 1", { exact: true }).fill("지원 동기");
    await page.getByLabel("문항 1 답변").fill("저는…");
    await page.getByRole("button", { name: "+ 문항 추가" }).click();
    await expect(page.getByLabel("문항 2", { exact: true })).toBeFocused();
    await page.getByLabel("문항 2", { exact: true }).fill("협업 경험");
    await page.getByLabel("문항 2 답변").fill("함께했습니다.");
    await page.getByRole("button", { name: "저장하기" }).click();

    await expect(page).toHaveURL(`/applications/${APPLICATION.id}`);
    // 저장 뒤 기록을 바꿔치기해, 뒤로 가면 저장한 내용이 든 지원서 쓰기가 아니라 목록으로 간다(같은 지원서를 또 만들지 않게).
    await page.goBack();
    await expect(page).toHaveURL("/applications");
    // 저장 액션이 refresh로 BFCache를 비웠으므로, 저장 전에 본 목록이 아니라 새 지원서가 맨 위에 든 4.3을 다시 받는다.
    await expect(list(page).getByRole("link")).toHaveCount(3);
    await expect(list(page).getByRole("link").first()).toHaveAttribute(
      "href",
      `/applications/${APPLICATION.id}`,
    );
    expect(body).toEqual({
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      coverLetterItems: [
        { question: "지원 동기", answer: "저는…" },
        { question: "협업 경험", answer: "함께했습니다." },
      ],
    } satisfies ApplicationCreateRequest);
  });

  test("서버가 자기소개서를 거절하면(400) 자기소개서 아래에 서버 문구를 보여 주고 그 화면에 남는다", async ({
    page,
    msw,
  }) => {
    const [{ reason }] = PROBLEM.COVER_LETTER_UNUSABLE.errors;
    msw.use(http.post(api("/applications"), () => problemResponse(PROBLEM.COVER_LETTER_UNUSABLE)));
    await page.goto("/applications/new");

    await page.getByLabel("회사명").fill("○○전자");
    await page.getByLabel("직무").fill("백엔드 개발자");
    await page.getByLabel("문항 1", { exact: true }).fill("지원 동기");
    await page.getByLabel("문항 1 답변").fill("네");
    await page.getByRole("button", { name: "저장하기" }).click();

    await expect(main(page).getByRole("group", { name: "자기소개서" })).toHaveAccessibleDescription(
      reason,
    );
    await expect(page).toHaveURL("/applications/new");
  });

  test("회사명을 4.7 회사 목록에서 별칭(네이버)으로 찾아 고르면 그 회사명(NAVER)으로 저장한다", async ({
    page,
    msw,
  }) => {
    let body: ApplicationCreateRequest | undefined;
    msw.use(
      http.post(api("/applications"), async ({ request }) => {
        body = (await request.json()) as ApplicationCreateRequest;
        return HttpResponse.json(APPLICATION, { status: 201 });
      }),
    );
    await page.goto("/applications/new");
    const company = page.getByRole("combobox", { name: "회사명" });
    // 목록은 포커스로 열리므로 React가 붙은 뒤에 누른다
    await hydrated(company);

    await company.click();
    await expect(page.getByRole("option")).toHaveText(COMPANIES.content.map((c) => c.name));
    await company.fill("네이버");
    await page.getByRole("option", { name: /^NAVER/ }).click();
    await expect(company).toHaveValue("NAVER");
    await expect(page.getByRole("listbox")).toBeHidden();
    await page.getByLabel("직무").fill("백엔드 개발자");
    await page.getByLabel("문항 1", { exact: true }).fill("지원 동기");
    await page.getByLabel("문항 1 답변").fill("저는…");
    await page.getByRole("button", { name: "저장하기" }).click();

    await expect(page).toHaveURL(`/applications/${APPLICATION.id}`);
    expect(body?.companyName).toBe("NAVER");
  });

  test("회사 목록을 받지 못하면(4.7 500) 회사명은 목록 없는 일반 입력칸이다", async ({
    page,
    msw,
  }) => {
    msw.use(http.get(api("/companies"), () => problemResponse(PROBLEM.INTERNAL_ERROR)));
    await page.goto("/applications/new");

    await page.getByLabel("회사명").fill("네이버");

    await expect(page.getByRole("combobox", { name: "회사명" })).toHaveCount(0);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByLabel("회사명")).toHaveValue("네이버");
  });

  test("[← 뒤로]는 지원 관리 목록으로 간다", async ({ page }) => {
    await page.goto("/applications/new");

    await page.getByRole("link", { name: "뒤로" }).click();

    await expect(page).toHaveURL("/applications");
  });
});
