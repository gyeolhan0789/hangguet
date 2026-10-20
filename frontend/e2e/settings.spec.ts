import type { Page } from "@playwright/test";

import { ACCESS_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";
import type {
  NicknameRequest,
  PasswordChangeRequest,
  ProfileImageRequest,
  ProfileImageUploadUrlRequest,
  WithdrawRequest,
} from "../src/types/api";

import { ME, PROBLEM, UPLOAD_URL } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S09-1 설정
// 근거: Figma S09-1 설정(18:3157) · 기획 메모 S09-1(18:1251: 프로필 사진 변경 · 삭제 / 닉네임 변경 / 이메일 변경 불가 / 비밀번호 변경,
//   연습 알림 메일은 추가 예정(비활성), 회원 탈퇴 → 확인 모달) · 모션 메모 S09-1(18:3261: 사진 업로드 후 체크 토스트, 닉네임 인라인 편집,
//   알림 토글 흔들림 + 툴팁 '곧 열려요!', 탈퇴 확인 모달 · 빨간 버튼) · 기획 메모 C01(18:1202: 로그아웃 → 확인 없이 S00)
//   · Swagger 2.2 닉네임 · 2.3 비밀번호 · 2.4 업로드 주소 · 2.5 등록 · 2.6 삭제 · 2.7 탈퇴 · 1.5 로그아웃
// 입력 규칙 경계값과 서버 응답별 처리는 단위 테스트(user/schemas.test.ts · user/actions.test.ts)가 맡는다.

const S09_1 = "/mypage/settings";
const main = (page: Page) => page.getByRole("main");
const section = (page: Page, name: string) => main(page).getByRole("region", { name });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

/** 1×1 PNG */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ signIn }) => {
  await signIn();
});

test.describe("S09-1 설정 · 화면", () => {
  test("'‹ 마이페이지' · 제목 · 계정 · 알림 · 기타 · 회원 탈퇴가 보이고, 이메일은 바꿀 수 없다", async ({
    page,
  }) => {
    await page.goto(S09_1);

    await expect(main(page).getByRole("link", { name: "마이페이지" })).toHaveAttribute(
      "href",
      "/mypage",
    );
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveText("설정");
    const account = section(page, "계정");
    await expect(account.getByText(ME.email)).toBeVisible();
    await expect(account.getByText("변경 불가")).toBeVisible();
    await expect(account.getByRole("button", { name: /닉네임/ })).toContainText(ME.nickname);
    await expect(section(page, "알림").getByText("추가 예정")).toBeVisible();
    await expect(section(page, "기타").getByRole("button", { name: "로그아웃" })).toBeVisible();
    await expect(main(page).getByRole("button", { name: "회원 탈퇴" })).toBeVisible();
  });

  test("S09 프로필 사진 ✎를 누르면 설정의 프로필 사진 줄로 온다", async ({ page }) => {
    await page.goto("/mypage");

    await main(page).getByRole("link", { name: "프로필 사진 바꾸기" }).click();

    await expect(page).toHaveURL(`${S09_1}#profile-image`);
    await expect(main(page).getByRole("button", { name: "사진 변경" })).toBeInViewport();
  });
});

test.describe("S09-1 설정 · 닉네임(2.2)", () => {
  test("줄을 누르면 그 자리에서 입력칸으로 바뀌고, 저장하면 2.2로 바꾼 뒤 새 닉네임을 보여 준다", async ({
    page,
    msw,
  }) => {
    const bodies: NicknameRequest[] = [];
    let nickname = ME.nickname;
    msw.use(
      http.patch(api("/users/me"), async ({ request }) => {
        const body = (await request.json()) as NicknameRequest;
        bodies.push(body);
        nickname = body.nickname;
        return HttpResponse.json({ ...ME, nickname });
      }),
      http.get(api("/users/me"), () => HttpResponse.json({ ...ME, nickname })),
    );
    await page.goto(S09_1);

    await section(page, "계정")
      .getByRole("button", { name: /닉네임/ })
      .click();
    const input = main(page).getByRole("textbox", { name: "닉네임" });
    await expect(input).toHaveValue(ME.nickname);
    await expect(input).toBeFocused();
    await input.fill("  새 닉네임  ");
    await main(page).getByRole("button", { name: "저장" }).click();

    await expect(section(page, "계정").getByRole("button", { name: /닉네임/ })).toContainText(
      "새 닉네임",
    );
    expect(bodies).toEqual([{ nickname: "새 닉네임" }]);
  });

  test("비워 두면 보내지 않고 안내하며, Esc로 편집을 그만둔다", async ({ page, msw }) => {
    const bodies: unknown[] = [];
    msw.use(
      http.patch(api("/users/me"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(ME);
      }),
    );
    await page.goto(S09_1);
    await section(page, "계정")
      .getByRole("button", { name: /닉네임/ })
      .click();
    const input = main(page).getByRole("textbox", { name: "닉네임" });

    await input.fill("   ");
    await input.press("Enter");
    await expect(main(page).getByRole("alert")).toHaveText("필수 값입니다.");
    await input.press("Escape");

    await expect(section(page, "계정").getByRole("button", { name: /닉네임/ })).toContainText(
      ME.nickname,
    );
    expect(bodies).toEqual([]);
  });
});

test.describe("S09-1 설정 · 비밀번호 변경(2.3)", () => {
  test("줄을 누르면 입력칸이 펼쳐지고, 바꾸면 2.3을 부르고 체크 토스트를 띄운 뒤 닫힌다", async ({
    page,
    msw,
  }) => {
    const bodies: PasswordChangeRequest[] = [];
    msw.use(
      http.patch(api("/users/me/password"), async ({ request }) => {
        bodies.push((await request.json()) as PasswordChangeRequest);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto(S09_1);
    const row = section(page, "계정").getByRole("button", { name: "비밀번호 변경" });

    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await main(page).getByLabel("지금 비밀번호").fill("password1");
    await main(page).getByLabel("새 비밀번호").fill("newpass123");
    await main(page).getByRole("button", { name: "변경", exact: true }).click();

    await expect(toast(page, "비밀번호를 바꿨어요")).toBeVisible();
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(main(page).getByLabel("지금 비밀번호")).toBeHidden();
    expect(bodies).toEqual([{ currentPassword: "password1", newPassword: "newpass123" }]);
  });

  test("지금 비밀번호가 틀리면(400 PASSWORD_MISMATCH) 그 칸 아래에 서버 문구를 보여 준다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.patch(api("/users/me/password"), () => problemResponse(PROBLEM.PASSWORD_MISMATCH)),
    );
    await page.goto(S09_1);
    await section(page, "계정").getByRole("button", { name: "비밀번호 변경" }).click();
    await main(page).getByLabel("지금 비밀번호").fill("wrongpass1");
    await main(page).getByLabel("새 비밀번호").fill("newpass123");
    await main(page).getByRole("button", { name: "변경", exact: true }).click();

    await expect(main(page).getByRole("alert")).toHaveText(PROBLEM.PASSWORD_MISMATCH.detail);
    await expect(main(page).getByLabel("지금 비밀번호")).toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("S09-1 설정 · 프로필 사진(2.4 · 2.5 · 2.6)", () => {
  test("사진을 고르면 2.4 → S3에 PUT → 2.5 순서로 올리고 체크 토스트를 띄운다", async ({
    page,
    msw,
  }) => {
    const calls: string[] = [];
    const uploadBodies: ProfileImageUploadUrlRequest[] = [];
    const registerBodies: ProfileImageRequest[] = [];
    msw.use(
      http.post(api("/users/me/profile-image/upload-url"), async ({ request }) => {
        calls.push("2.4");
        uploadBodies.push((await request.json()) as ProfileImageUploadUrlRequest);
        return HttpResponse.json(UPLOAD_URL);
      }),
      http.put(api("/users/me/profile-image"), async ({ request }) => {
        calls.push("2.5");
        registerBodies.push((await request.json()) as ProfileImageRequest);
        return HttpResponse.json(ME);
      }),
    );
    // 브라우저가 S3로 직접 보내는 PUT은 테스트 브라우저에서 가로챈다.
    // Chromium에서는 가로채기가 켜져 있으면 CORS 프리플라이트(OPTIONS)에 Playwright가 직접 답하고 CORS 헤더도 붙인다.
    const s3: { method: string; contentType: string | undefined }[] = [];
    await page.route(UPLOAD_URL.uploadUrl, async (route) => {
      calls.push("S3");
      s3.push({
        method: route.request().method(),
        contentType: route.request().headers()["content-type"],
      });
      await route.fulfill({ status: 200 });
    });
    await page.goto(S09_1);

    await main(page).getByLabel("프로필 사진 파일").setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: PNG,
    });

    await expect(toast(page, "프로필 사진을 바꿨어요")).toBeVisible();
    expect(calls).toEqual(["2.4", "S3", "2.5"]);
    expect(uploadBodies).toEqual([{ contentType: "image/png", size: PNG.length }]);
    expect(s3).toEqual([{ method: "PUT", contentType: "image/png" }]);
    expect(registerBodies).toEqual([{ objectKey: UPLOAD_URL.objectKey }]);
  });

  test("JPG · PNG가 아니면 올리지 않고 토스트로 알린다", async ({ page, msw }) => {
    const calls: string[] = [];
    msw.use(
      http.post(api("/users/me/profile-image/upload-url"), () => {
        calls.push("2.4");
        return HttpResponse.json(UPLOAD_URL);
      }),
    );
    await page.goto(S09_1);

    await main(page).getByLabel("프로필 사진 파일").setInputFiles({
      name: "me.gif",
      mimeType: "image/gif",
      buffer: PNG,
    });

    await expect(toast(page, "JPG·PNG만 올릴 수 있습니다.")).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("S3에 올리지 못하면 2.5를 부르지 않고 다시 시도 안내를 띄운다", async ({ page, msw }) => {
    const calls: string[] = [];
    msw.use(
      http.put(api("/users/me/profile-image"), () => {
        calls.push("2.5");
        return HttpResponse.json(ME);
      }),
    );
    await page.route(UPLOAD_URL.uploadUrl, (route) => route.fulfill({ status: 403 }));
    await page.goto(S09_1);

    await main(page).getByLabel("프로필 사진 파일").setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: PNG,
    });

    await expect(toast(page, "잠시 후 다시 시도해 주세요.")).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("올린 파일을 서버가 찾지 못하면(404 FILE_NOT_FOUND) 서버 문구를 토스트로 띄운다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.put(api("/users/me/profile-image"), () => problemResponse(PROBLEM.FILE_NOT_FOUND)),
    );
    await page.route(UPLOAD_URL.uploadUrl, (route) => route.fulfill({ status: 200 }));
    await page.goto(S09_1);

    await main(page).getByLabel("프로필 사진 파일").setInputFiles({
      name: "me.png",
      mimeType: "image/png",
      buffer: PNG,
    });

    await expect(toast(page, PROBLEM.FILE_NOT_FOUND.detail)).toBeVisible();
  });

  test("[삭제]는 2.6으로 사진을 지우고, 다시 불러온 내 정보(사진 없음)대로 기본 아이콘만 남는다", async ({
    page,
    msw,
  }) => {
    let profileImageUrl: string | null = "https://e2e.test/me.png";
    msw.use(
      http.get(api("/users/me"), () => HttpResponse.json({ ...ME, profileImageUrl })),
      http.delete(api("/users/me/profile-image"), () => {
        profileImageUrl = null;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto(S09_1);
    // 사진은 장식(배경 이미지)이라 역할 · 이름이 없어 testid로 찾는다.
    const photo = section(page, "계정").getByTestId("avatar-image");
    await expect(photo).toHaveCount(1);

    await main(page).getByRole("button", { name: "삭제" }).click();

    await expect(photo).toHaveCount(0);
  });
});

test.describe("S09-1 설정 · 알림 · 로그아웃", () => {
  test("연습 알림 메일 토글은 추가 예정이라 눌러도 꺼진 채로 툴팁 '곧 열려요!'만 뜬다", async ({
    page,
  }) => {
    await page.goto(S09_1);
    const toggle = section(page, "알림").getByRole("switch", { name: "연습 알림 메일" });

    await toggle.click();

    await expect(section(page, "알림").getByText("곧 열려요!")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("로그아웃은 확인 없이 1.5를 부르고 랜딩(S00)으로 간다", async ({ page, msw, context }) => {
    const calls: string[] = [];
    msw.use(
      http.post(api("/auth/logout"), () => {
        calls.push("1.5");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto(S09_1);

    await section(page, "기타").getByRole("button", { name: "로그아웃" }).click();

    await expect(page).toHaveURL("/");
    expect(calls).toEqual(["1.5"]);
    expect((await context.cookies()).some((c) => c.name === ACCESS_TOKEN_COOKIE)).toBe(false);
  });
});

test.describe("S09-1 설정 · 회원 탈퇴(2.7)", () => {
  const dialog = (page: Page) => page.getByRole("dialog", { name: "정말 탈퇴할까요?" });

  test("확인 모달에서 비밀번호를 넣고 [탈퇴하기]를 누르면 2.7로 탈퇴하고 쿠키를 지운 뒤 랜딩(S00)으로 간다", async ({
    page,
    msw,
    context,
  }) => {
    const bodies: WithdrawRequest[] = [];
    msw.use(
      http.post(api("/users/me"), async ({ request }) => {
        bodies.push((await request.json()) as WithdrawRequest);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto(S09_1);

    await main(page).getByRole("button", { name: "회원 탈퇴" }).click();
    await expect(dialog(page)).toHaveAccessibleDescription(
      "기록 · 스트릭이 모두 사라져요 되돌릴 수 없어요",
    );
    await dialog(page).getByLabel("비밀번호", { exact: true }).fill("password1");
    await dialog(page).getByRole("button", { name: "탈퇴하기" }).click();

    await expect(page).toHaveURL("/");
    expect(bodies).toEqual([{ password: "password1" }]);
    expect((await context.cookies()).some((c) => c.name === ACCESS_TOKEN_COOKIE)).toBe(false);
  });

  test("비밀번호가 틀리면(400 PASSWORD_MISMATCH) 모달에 서버 문구를 보여 주고 그대로 둔다", async ({
    page,
    msw,
  }) => {
    msw.use(http.post(api("/users/me"), () => problemResponse(PROBLEM.PASSWORD_MISMATCH)));
    await page.goto(S09_1);
    await main(page).getByRole("button", { name: "회원 탈퇴" }).click();
    await dialog(page).getByLabel("비밀번호", { exact: true }).fill("wrongpass1");
    await dialog(page).getByRole("button", { name: "탈퇴하기" }).click();

    await expect(dialog(page).getByRole("alert")).toHaveText(PROBLEM.PASSWORD_MISMATCH.detail);
    await expect(page).toHaveURL(S09_1);
  });

  test("[취소] · Esc로 모달을 닫는다", async ({ page }) => {
    await page.goto(S09_1);
    const open = main(page).getByRole("button", { name: "회원 탈퇴" });

    await open.click();
    await dialog(page).getByRole("button", { name: "취소" }).click();
    await expect(dialog(page)).toBeHidden();

    await open.click();
    await expect(dialog(page).getByLabel("비밀번호", { exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });
});
