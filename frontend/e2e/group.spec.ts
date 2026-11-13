// 기준: Figma [초안] S05-1 함께 보기(488:2510) · G02 그룹 만들기(484:2318) · G03 초대 확인 · 참가(484:2552) · G01 대기실(480:2414)
//   · BE Swagger 10.1 그룹 만들기 · 10.2 초대 확인 · 10.3 그룹 참가 · 10.4 그룹 조회 · API 명세 10.10(5.2 group)
// 폼 값 · 문구 · 멱등 키는 컴포넌트 · 단위 테스트가, 여기서는 실제 서버 왕복으로만 확인되는 화면 이동(주소 분기)을 본다.

import { APPLICATION, GROUP, INVITE, SESSION_GROUP_WAITING } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

/** 대기실(10.4)이 2초마다 다시 부르는 동안 같은 그룹을 준다 */
const lobby = http.get(api("/interview-groups/:groupId"), () => HttpResponse.json(GROUP));

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("G02 · 그룹 만들기", () => {
  test.describe("정상 처리", () => {
    test("S05-1에서 함께 보기를 켜고 [다음]을 누르면 G02를 거쳐 그룹을 만든 뒤 대기실로 간다", async ({
      page,
      msw,
    }) => {
      msw.use(
        // S05-1은 4.2로 받은 지원서 id를 넘기고, G02는 4.3 목록에 있는 지원서만 받는다(목록 예시의 12)
        http.get(api("/applications/:applicationId"), () =>
          HttpResponse.json({ ...APPLICATION, id: 12 }),
        ),
        http.post(api("/interview-groups"), () => HttpResponse.json(GROUP, { status: 201 })),
        lobby,
      );
      await page.goto("/practice/mode?applicationId=12&persona=COFFEE_CHAT");
      // 라디오는 카드 안에 숨겨져 있어 카드 제목을 누른다(사용자가 카드를 누르는 것과 같다)
      await page.getByText("채팅으로 할래요", { exact: true }).click();
      await page.getByRole("switch", { name: "친구와 함께 볼래요" }).click();
      await page.getByRole("button", { name: "다음: 그룹 만들기" }).click();
      await expect(page).toHaveURL("/groups/new?applicationId=12&persona=COFFEE_CHAT&mode=CHAT");

      await page.getByRole("button", { name: "그룹 만들기" }).click();

      await expect(page).toHaveURL("/groups/7");
      await expect(page.getByRole("heading", { name: "그룹 면접 대기실" })).toBeVisible();
    });
  });

  test.describe("입력 검증", () => {
    test("주소에 면접 방식이 없으면 S05-1로 돌려보낸다", async ({ page }) => {
      await page.goto("/groups/new?applicationId=12&persona=COFFEE_CHAT");

      await expect(page).toHaveURL("/practice/mode?applicationId=12&persona=COFFEE_CHAT");
    });
  });
});

test.describe("G03 · 초대 확인 · 참가", () => {
  test.describe("정상 처리", () => {
    test("초대 링크로 들어와 [참가하기]를 누르면 대기실로 간다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/interview-groups/invites/:inviteCode"), () => HttpResponse.json(INVITE)),
        http.post(api("/interview-groups/join"), () => HttpResponse.json(GROUP, { status: 201 })),
        lobby,
      );
      await page.goto("/groups/invite/K7Q2ZP");

      await page.getByRole("button", { name: "참가하기" }).click();

      await expect(page).toHaveURL("/groups/7");
    });
  });

  test.describe("오류 처리", () => {
    test("들어갈 수 없는 초대 코드면(10.2 404) 들어갈 수 없다고 알린다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/interview-groups/invites/:inviteCode"), () =>
          problemResponse({
            title: "Not Found",
            status: 404,
            detail: "그룹을 찾을 수 없어요.",
            code: "GROUP_NOT_FOUND",
          }),
        ),
      );

      await page.goto("/groups/invite/K7Q2ZP");

      await expect(page.getByRole("heading", { name: "들어갈 수 없는 초대예요" })).toBeVisible();
    });
  });
});

test.describe("G01 · 그룹 면접 대기실", () => {
  test.describe("상태 변화", () => {
    test("그룹이 시작했으면(10.4 IN_PROGRESS) 내 면접 화면으로 보낸다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/interview-groups/:groupId"), () =>
          HttpResponse.json({ ...GROUP, status: "IN_PROGRESS", inviteCode: null }),
        ),
        // 면접 화면이 그룹 면접방을 그리도록 내 면접도 시작한 그룹 면접으로 답한다(5.2 group IN_PROGRESS)
        http.get(api("/interview-sessions/:sessionId"), () =>
          HttpResponse.json({
            ...SESSION_GROUP_WAITING,
            status: "IN_PROGRESS",
            planStatus: "READY",
            planProgress: null,
            group: { groupId: 7, status: "IN_PROGRESS" },
          }),
        ),
      );

      await page.goto("/groups/7");

      await expect(page).toHaveURL("/interview/55");
    });

    test("그룹이 취소됐으면(10.4 CANCELLED) 홈으로 보낸다", async ({ page, msw }) => {
      msw.use(
        http.get(api("/interview-groups/:groupId"), () =>
          HttpResponse.json({ ...GROUP, status: "CANCELLED", inviteCode: null }),
        ),
      );

      await page.goto("/groups/7");

      await expect(page).toHaveURL("/home");
    });
    test("시작 전 그룹 면접 주소로 오면(5.2 group WAITING) 대기실로 보낸다", async ({
      page,
      msw,
    }) => {
      msw.use(
        http.get(api("/interview-sessions/:sessionId"), () =>
          HttpResponse.json(SESSION_GROUP_WAITING),
        ),
        lobby,
      );

      await page.goto("/interview/55");

      await expect(page).toHaveURL("/groups/7");
    });
  });
});
