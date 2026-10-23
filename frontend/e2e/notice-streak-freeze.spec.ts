import type { Page } from "@playwright/test";

import { NOTICES, STREAK_FREEZE_USED, STREAK_FREEZES } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// C01 공지 버튼 · C02 공지 모달 · C03 공지 목록 펼침 · S09 스트릭 유지권 · S09-2 사용 확인 · S09-3 사용 완료
// 근거: Figma C/App Header 공지 버튼 · C02(255:891) · C03(260:891) · S09 스트릭 유지권 박스(18:3075) · S09-2 · S09-3
//   · 기획 메모 C01 · C02 · C03 · S09 · S09-2 · S09-3 · Swagger 8.8 · 8.9 · 8.13 · 8.14
// 칸별 문구 · 순서 · 오류 문구는 컴포넌트 테스트가, 여기서는 서버 컴포넌트가 받은 응답으로 그리고 서버 액션이 실제 API를 부르는지 본다.

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

const header = (page: Page) => page.getByRole("banner");

test.describe("공지(C01 · C02 · C03)", () => {
  test("앱에 들어오면 확인 안 한 공지가 C02로 뜨고, [확인]하면 8.9로 확인한 뒤 닫힌다", async ({
    page,
    msw,
  }) => {
    // 서버 상태: 확인하면(8.9) 그 공지의 read가 true가 된다
    const reads: string[] = [];
    msw.use(
      http.get(api("/notices"), () =>
        HttpResponse.json({
          content: NOTICES.content.map((n) => ({
            ...n,
            read: n.read || reads.includes(String(n.id)),
          })),
        }),
      ),
      http.post(api("/notices/:noticeId/read"), ({ params }) => {
        reads.push(String(params.noticeId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto("/home");

    const dialog = page.getByRole("dialog", { name: "10월 점검 안내" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "확인" }).click();

    await expect(dialog).toBeHidden();
    expect(reads).toEqual(["3"]);
    // 다시 그린 헤더: 확인 안 한 공지가 없어 종의 점(이름)이 사라지고, 목록에서 확인함으로 바뀐다
    const bell = header(page).getByRole("button", { name: "공지", exact: true });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(header(page).getByRole("menuitem", { name: /10월 점검 안내/ })).toContainText(
      "확인함",
    );
  });

  test("종을 누르면 C03 목록이 펼쳐지고, 공지가 없으면 '공지가 없어요'", async ({ page }) => {
    await page.goto("/home");

    await header(page).getByRole("button", { name: "공지", exact: true }).click();

    await expect(header(page).getByRole("menu", { name: "공지" })).toContainText("공지가 없어요");
  });
});

test.describe("S09 스트릭 유지권", () => {
  test("[메우기] → S09-2 → 8.14로 메우고 S09-3 '유지권 사용 완료!'가 뜬다", async ({
    page,
    msw,
  }) => {
    // 서버 상태: 쓴 유지권은 8.13 목록에서 빠진다
    const bodies: { freezeId: number }[] = [];
    msw.use(
      http.get(api("/users/me/streak-freezes"), () => {
        const left = STREAK_FREEZES.freezes.filter((f) => !bodies.some((b) => b.freezeId === f.id));
        return HttpResponse.json({ availableCount: left.length, freezes: left });
      }),
      http.post(api("/users/me/streak-freezes/use"), async ({ request }) => {
        bodies.push((await request.json()) as { freezeId: number });
        return HttpResponse.json(STREAK_FREEZE_USED);
      }),
    );
    await page.goto("/mypage");
    const card = page.getByRole("region", { name: "스트릭 유지권" });

    await expect(card).toContainText(`소유한 유지권 ${STREAK_FREEZES.availableCount}개`);
    await card.getByRole("button", { name: "메우기" }).first().click();
    const confirm = page.getByRole("dialog", { name: "스트릭 유지권을 사용하시겠습니까?" });
    await expect(confirm).toContainText("날짜 : 2026.10.19");
    await confirm.getByRole("button", { name: "메우기" }).click();

    const done = page.getByRole("dialog", { name: "유지권 사용 완료!" });
    await expect(done).toBeVisible();
    expect(bodies).toEqual([{ freezeId: 31 }]);
    await done.getByRole("button", { name: "확인" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // 다시 그린 박스: 쓴 유지권(10월 19일)이 빠지고 1개가 남는다
    await expect(card).toContainText("소유한 유지권 1개");
    await expect(card.getByText("10월 19일")).toHaveCount(0);
    await expect(card.getByText("10월 22일")).toBeVisible();
  });

  test("이미 연습한 날이면(409) 모달을 닫고 서버 문구를 토스트로 알린다", async ({ page, msw }) => {
    msw.use(
      http.post(api("/users/me/streak-freezes/use"), () =>
        problemResponse({
          title: "Conflict",
          status: 409,
          detail: "이미 연습한 날이라 메울 수 없어요.",
          instance: "/api/v1/users/me/streak-freezes/use",
          code: "STREAK_FREEZE_DATE_NOT_ALLOWED",
        }),
      ),
    );
    await page.goto("/mypage");

    await page
      .getByRole("region", { name: "스트릭 유지권" })
      .getByRole("button", { name: "메우기" })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "스트릭 유지권을 사용하시겠습니까?" })
      .getByRole("button", { name: "메우기" })
      .click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "이미 연습한 날이라 메울 수 없어요." }),
    ).toBeVisible();
  });
});
