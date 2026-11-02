import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import { ACCESS_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";
import type {
  MeResponse,
  NicknameRequest,
  PasswordChangeRequest,
  PracticeAlarmResponse,
  PracticeAlarmTimeRequest,
  ProfileImageRequest,
  ProfileImageUploadUrlRequest,
  SocialLinkRequest,
  WithdrawRequest,
} from "../src/types/api";

import {
  KAKAO_ME,
  ME,
  NICKNAME_CHANGED,
  PRACTICE_ALARM_OFF,
  PROBLEM,
  UPLOAD_URL,
} from "./mocks/data";
import { cookie, interceptKakao, KAKAO_CALLBACK, KAKAO_NOTICE_COOKIE } from "./kakao";
import {
  api,
  expect,
  http,
  HttpResponse,
  hydrated,
  pauseClock,
  problemResponse,
  test,
} from "./test";

// S09-1 설정
// 근거: Figma S09-1 설정(18:3157) · S09-1-B 카카오 연결됨(436:2104) · 기획 메모 S09-1(18:1251: 프로필 사진 변경 · 삭제 / 닉네임 변경
//   / 이메일 변경 불가 / 비밀번호 변경, 카카오 줄, 카카오톡 연습 알림(2.8 available false면 비활성), 회원 탈퇴 → 확인 모달)
//   · 기획 메모 S09-1-B(428:2146: 토글 켜기 → 카카오 동의 → 콜백 2.9, 끄기 2.11, 시간 › 2.10, 오류는 토스트) · 모션 메모 S09-1
//   (18:3261: 사진 업로드 후 체크 토스트, 닉네임 · 알림 시간 인라인 편집, 탈퇴 확인 모달 · 빨간 버튼) · 기획 메모 C01(18:1202: 로그아웃
//   → 확인 없이 S00) · Swagger 2.2 닉네임 · 2.3 비밀번호 · 2.4 업로드 주소 · 2.5 등록 · 2.6 삭제 · 2.7 탈퇴 · 2.8~2.11 연습 알림 · 1.5
//   · 2.12 소셜 계정 연결 · 2.13 연결 해제 · 사용자 결정(연결하면 '연결이 완료되었어요' 안내 모달, 해제는 확인 모달, 오류는 토스트)
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
    await expect(section(page, "알림").getByText("카카오 연결 필요")).toBeVisible();
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
    const meAuthorizations: (string | null)[] = [];
    let nickname = ME.nickname;
    msw.use(
      http.patch(api("/users/me"), async ({ request }) => {
        const body = (await request.json()) as NicknameRequest;
        bodies.push(body);
        nickname = body.nickname;
        return HttpResponse.json({ ...NICKNAME_CHANGED, nickname });
      }),
      http.get(api("/users/me"), ({ request }) => {
        meAuthorizations.push(request.headers.get("Authorization"));
        return HttpResponse.json({ ...ME, nickname });
      }),
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
    // 2.2가 준 새 액세스 토큰을 쿠키에 저장해, 다시 그릴 때의 2.1부터 그 토큰을 쓴다(웹 Swagger 2.2).
    await expect.poll(() => meAuthorizations).toContain(`Bearer ${NICKNAME_CHANGED.accessToken}`);
  });

  test("비워 두면 보내지 않고 안내하며, Esc로 편집을 그만둔다", async ({ page, msw }) => {
    const bodies: unknown[] = [];
    msw.use(
      http.patch(api("/users/me"), async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(NICKNAME_CHANGED);
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
  test("카카오를 연결하지 않은 이메일 회원은 카카오 '연결하기' 줄이 있고, 카카오톡 연습 알림은 이유와 함께 비활성이다", async ({
    page,
  }) => {
    await page.goto(S09_1);

    await expect(
      section(page, "계정").getByRole("button", { name: /카카오\s*연결하기/ }),
    ).toBeVisible();
    const toggle = section(page, "알림").getByRole("switch", { name: "카카오톡 연습 알림" });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAccessibleDescription("카카오 계정 연결이 필요한 기능이에요");
    await expect(section(page, "알림").getByText("매일 21:00")).toBeVisible();
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

test.describe("S09-1-B 카카오 회원 · 연습 알림(2.8~2.11)", () => {
  /** 서버 상태: 2.9 · 2.10 · 2.11이 바꾼 설정을 2.8이 돌려준다 */
  function alarmServer(msw: MswFixture, start: PracticeAlarmResponse) {
    let alarm = { ...start };
    const calls: string[] = [];
    msw.use(
      http.get(api("/users/me"), () => HttpResponse.json(KAKAO_ME)),
      http.get(api("/users/me/practice-alarm"), () => HttpResponse.json(alarm)),
      http.put(api("/users/me/practice-alarm"), async ({ request }) => {
        calls.push(`PUT ${JSON.stringify(await request.json())}`);
        alarm = { ...alarm, enabled: true };
        return HttpResponse.json(alarm);
      }),
      http.patch(api("/users/me/practice-alarm"), async ({ request }) => {
        const { time } = (await request.json()) as PracticeAlarmTimeRequest;
        calls.push(`PATCH ${time}`);
        alarm = { ...alarm, time };
        return HttpResponse.json(alarm);
      }),
      http.delete(api("/users/me/practice-alarm"), () => {
        calls.push("DELETE");
        alarm = { ...alarm, enabled: false };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return calls;
  }

  const alarmSection = (page: Page) => section(page, "알림");
  const toggle = (page: Page) =>
    alarmSection(page).getByRole("switch", { name: "카카오톡 연습 알림" });

  /** 꺼진 토글을 눌러 카카오 메시지 동의 화면까지 간다(서버가 state 쿠키를 심는다) */
  async function startAlarm(page: Page) {
    const kakao = await interceptKakao(page);
    await page.goto(S09_1);
    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    await hydrated(toggle(page));
    await toggle(page).click();
    await expect(page).toHaveTitle("카카오");
    return kakao;
  }

  test("카카오 줄은 '연결됨', 비밀번호가 없어 비밀번호 변경은 누를 수 없다", async ({
    page,
    msw,
  }) => {
    alarmServer(msw, PRACTICE_ALARM_OFF);
    await page.goto(S09_1);

    await expect(section(page, "계정").getByText("연결됨")).toBeVisible();
    // 카카오로 가입한 회원은 연결을 해제할 수 없다(2.13 409 PASSWORD_NOT_SET)
    await expect(section(page, "계정").getByRole("button", { name: "연결 해제" })).toHaveCount(0);
    await expect(
      section(page, "계정").getByRole("button", { name: "비밀번호 변경" }),
    ).toBeDisabled();
    await expect(
      alarmSection(page).getByText("연습하지 않았다면 카카오톡으로 알려드릴게요"),
    ).toBeVisible();
  });

  test("꺼진 토글을 켜면 카카오 메시지 동의(talk_message)를 거쳐 2.9로 켜고 S09-1로 돌아온다", async ({
    page,
    msw,
  }) => {
    const calls = alarmServer(msw, PRACTICE_ALARM_OFF);
    const kakao = await startAlarm(page);
    expect(kakao.last().searchParams.get("scope")).toBe("talk_message");

    await kakao.returns({ code: "kakao-code" });

    await expect(page).toHaveURL(S09_1);
    await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
    expect(calls).toEqual([
      `PUT ${JSON.stringify({ code: "kakao-code", redirectUri: KAKAO_CALLBACK })}`,
    ]);
  });

  test("카카오 동의 화면에서 취소하면 문구 없이 S09-1로 돌아오고 토글은 꺼진 채", async ({
    page,
    msw,
    context,
  }) => {
    const calls = alarmServer(msw, PRACTICE_ALARM_OFF);
    const kakao = await startAlarm(page);

    await kakao.returns({ error: "access_denied" });

    await expect(page).toHaveURL(S09_1);
    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    expect(await cookie(context, KAKAO_NOTICE_COOKIE)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("다른 카카오 계정으로 동의하면(2.9 400) 토스트로 서버 문구를 보이고 토글은 꺼진 채, 새로 고치면 다시 뜨지 않는다", async ({
    page,
    msw,
    context,
  }) => {
    // 토스트가 2초 뒤 사라지는 시간에 기대지 않도록, 돌아온 화면이 뜬 뒤 시계를 멈춘다
    await page.clock.install();
    alarmServer(msw, PRACTICE_ALARM_OFF);
    msw.use(
      http.put(api("/users/me/practice-alarm"), () =>
        problemResponse({
          title: "Bad Request",
          status: 400,
          detail: "가입할 때 쓴 카카오 계정으로 동의해 주세요.",
          instance: "/api/v1/users/me/practice-alarm",
          code: "KAKAO_ACCOUNT_MISMATCH",
        }),
      ),
    );
    const kakao = await startAlarm(page);

    await kakao.returns({ code: "mismatch" });
    await expect(toggle(page)).toBeVisible();
    await pauseClock(page);

    await expect(toast(page, "가입할 때 쓴 카카오 계정으로 동의해 주세요.")).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => cookie(context, KAKAO_NOTICE_COOKIE)).toBeUndefined();

    // 멈춘 시계로는 스트리밍 화면이 나오지 않으므로 다시 흐르게 한 뒤 새로 고친다
    await page.clock.resume();
    await page.reload();
    await hydrated(toggle(page));
    await expect(toast(page, "가입할 때 쓴 카카오 계정으로 동의해 주세요.")).toHaveCount(0);
  });

  test("켜진 토글을 끄면 2.11을 부르고 꺼진다", async ({ page, msw }) => {
    const calls = alarmServer(msw, { ...PRACTICE_ALARM_OFF, enabled: true });
    await page.goto(S09_1);
    await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
    await hydrated(toggle(page));

    await toggle(page).click();

    await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
    expect(calls).toEqual(["DELETE"]);
  });

  test("끄기에 실패하면 토스트로 알리고 켜진 채로 둔다", async ({ page, msw }) => {
    await page.clock.install();
    alarmServer(msw, { ...PRACTICE_ALARM_OFF, enabled: true });
    msw.use(
      http.delete(api("/users/me/practice-alarm"), () =>
        problemResponse({ ...PROBLEM.INTERNAL_ERROR, instance: "/api/v1/users/me/practice-alarm" }),
      ),
    );
    await page.goto(S09_1);
    await hydrated(toggle(page));
    // 토스트가 2초 뒤 사라지는 시간에 기대지 않도록 시계를 멈춘다
    await pauseClock(page);

    await toggle(page).click();

    await expect(toast(page, PROBLEM.INTERNAL_ERROR.detail)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  });

  test("'매일 HH:mm ›'을 눌러 시간을 바꾸면 2.10을 부르고 새 시간을 보인다(꺼져 있어도)", async ({
    page,
    msw,
  }) => {
    const calls = alarmServer(msw, PRACTICE_ALARM_OFF);
    await page.goto(S09_1);
    const timeButton = alarmSection(page).getByRole("button", {
      name: "알림 시간 매일 21:00, 바꾸기",
    });
    await hydrated(timeButton);

    await timeButton.click();
    await alarmSection(page).getByLabel("알림 시간", { exact: true }).fill("22:30");
    await alarmSection(page).getByRole("button", { name: "저장" }).click();

    await expect(
      alarmSection(page).getByRole("button", { name: "알림 시간 매일 22:30, 바꾸기" }),
    ).toBeFocused();
    expect(calls).toEqual(["PATCH 22:30"]);
  });

  test("시간 변경에 실패하면(2.10 409) 토스트로 서버 문구를 보이고 입력칸을 열어 둔다", async ({
    page,
    msw,
  }) => {
    await page.clock.install();
    alarmServer(msw, PRACTICE_ALARM_OFF);
    msw.use(
      http.patch(api("/users/me/practice-alarm"), () =>
        problemResponse({
          title: "Conflict",
          status: 409,
          detail: "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
          instance: "/api/v1/users/me/practice-alarm",
          code: "PRACTICE_ALARM_UNAVAILABLE",
        }),
      ),
    );
    await page.goto(S09_1);
    const timeButton = alarmSection(page).getByRole("button", {
      name: "알림 시간 매일 21:00, 바꾸기",
    });
    await hydrated(timeButton);

    await timeButton.click();
    await alarmSection(page).getByLabel("알림 시간", { exact: true }).fill("22:30");
    // '매일 HH:mm ›' 줄이 사라지는 모션이 끝난 뒤(멈추면 그 줄이 [저장]을 덮는다), 토스트가 2초 뒤 사라지는 시간에
    // 기대지 않도록 시계를 멈춘다
    await expect(alarmSection(page).getByRole("button", { name: /바꾸기$/ })).toHaveCount(0);
    await pauseClock(page);
    await alarmSection(page).getByRole("button", { name: "저장" }).click();

    await expect(
      toast(page, "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요."),
    ).toBeVisible();
    await expect(alarmSection(page).getByLabel("알림 시간", { exact: true })).toHaveValue("22:30");
  });

  test("회원 탈퇴는 비밀번호 칸 없이 2.7에 본문 {}로 탈퇴한다", async ({ page, msw }) => {
    alarmServer(msw, PRACTICE_ALARM_OFF);
    const bodies: WithdrawRequest[] = [];
    msw.use(
      http.post(api("/users/me"), async ({ request }) => {
        bodies.push((await request.json()) as WithdrawRequest);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await page.goto(S09_1);
    const withdraw = main(page).getByRole("button", { name: "회원 탈퇴" });
    await hydrated(withdraw);

    await withdraw.click();
    const dialog = page.getByRole("dialog", { name: "정말 탈퇴할까요?" });
    await expect(dialog.getByLabel("비밀번호", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "취소" })).toBeFocused();
    await dialog.getByRole("button", { name: "탈퇴하기" }).click();

    await expect(page).toHaveURL("/");
    expect(bodies).toEqual([{}]);
  });
});

test.describe("S09-1 카카오 계정 연결(2.12 · 2.13)", () => {
  const account = (page: Page) => section(page, "계정");
  const linkRow = (page: Page) => account(page).getByRole("button", { name: /카카오\s*연결하기/ });
  const unlinkButton = (page: Page) => account(page).getByRole("button", { name: "연결 해제" });
  const linkedDialog = (page: Page) => page.getByRole("dialog", { name: "연결이 완료되었어요" });
  const confirmDialog = (page: Page) =>
    page.getByRole("dialog", { name: "카카오 연결을 해제할까요?" });

  /** 이메일 회원의 2.1 · 2.12 · 2.13. 연결 · 해제하면 2.1 linkedProvider가 바뀐다 */
  function accountServer(msw: MswFixture, linkedProvider: MeResponse["linkedProvider"]) {
    let me: MeResponse = { ...ME, linkedProvider };
    const calls: string[] = [];
    msw.use(
      http.get(api("/users/me"), () => HttpResponse.json(me)),
      http.put(api("/users/me/social-accounts/kakao"), async ({ request }) => {
        calls.push(`PUT ${JSON.stringify((await request.json()) as SocialLinkRequest)}`);
        me = { ...me, linkedProvider: "KAKAO" };
        return HttpResponse.json(me);
      }),
      http.delete(api("/users/me/social-accounts/kakao"), () => {
        calls.push("DELETE");
        me = { ...me, linkedProvider: null };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return calls;
  }

  /** '연결하기'를 눌러 카카오 동의 화면까지 간다(서버가 state 쿠키를 심는다) */
  async function startLink(page: Page) {
    const kakao = await interceptKakao(page);
    await page.goto(S09_1);
    await hydrated(linkRow(page));
    await linkRow(page).click();
    await expect(page).toHaveTitle("카카오");
    return kakao;
  }

  test("'연결하기'를 누르면 카카오 동의(동의 항목 없이)를 거쳐 2.12로 연결하고, 돌아와 완료 안내를 한 번 띄운다", async ({
    page,
    msw,
    context,
  }) => {
    const calls = accountServer(msw, null);
    const kakao = await startLink(page);
    expect(kakao.last().searchParams.get("scope")).toBeNull();

    await kakao.returns({ code: "kakao-code" });

    await expect(page).toHaveURL(S09_1);
    await expect(linkedDialog(page)).toBeVisible();
    await expect(linkedDialog(page).getByRole("button", { name: "확인" })).toBeFocused();
    expect(calls).toEqual([
      `PUT ${JSON.stringify({ code: "kakao-code", redirectUri: KAKAO_CALLBACK })}`,
    ]);
    // 완료 표시는 주소에 싣지 않고, 보여 준 뒤 쿠키에서 지운다
    expect(new URL(page.url()).search).toBe("");
    await expect.poll(() => cookie(context, KAKAO_NOTICE_COOKIE)).toBeUndefined();

    await linkedDialog(page).getByRole("button", { name: "확인" }).click();

    await expect(linkedDialog(page)).toHaveCount(0);
    await expect(account(page).getByText("연결됨")).toBeVisible();
    await expect(unlinkButton(page)).toBeFocused();

    await page.reload();
    await hydrated(unlinkButton(page));
    await expect(linkedDialog(page)).toHaveCount(0);
  });

  test("다른 회원이 쓰는 카카오 계정이면(2.12 409) 토스트로 서버 문구를 보이고 '연결하기' 그대로", async ({
    page,
    msw,
  }) => {
    await page.clock.install();
    accountServer(msw, null);
    msw.use(
      http.put(api("/users/me/social-accounts/kakao"), () =>
        problemResponse({
          title: "Conflict",
          status: 409,
          detail: "다른 회원이 쓰고 있는 카카오 계정이에요.",
          instance: "/api/v1/users/me/social-accounts/kakao",
          code: "SOCIAL_ACCOUNT_IN_USE",
        }),
      ),
    );
    const kakao = await startLink(page);

    await kakao.returns({ code: "in-use" });
    await expect(linkRow(page)).toBeVisible();
    // 토스트가 2초 뒤 사라지는 시간에 기대지 않도록, 돌아온 화면이 뜬 뒤 시계를 멈춘다
    await pauseClock(page);

    await expect(toast(page, "다른 회원이 쓰고 있는 카카오 계정이에요.")).toBeVisible();
    await expect(linkedDialog(page)).toHaveCount(0);
  });

  test("카카오 동의 화면에서 취소하면 2.12를 부르지 않고 문구 없이 S09-1로 돌아온다", async ({
    page,
    msw,
  }) => {
    const calls = accountServer(msw, null);
    const kakao = await startLink(page);
    // 문구 · 완료 표시를 남기지 않았는지는 콜백 응답(이동)의 Set-Cookie로 본다: 화면에 띄운 뒤 지워진 쿠키로는 판정할 수 없다
    const callback = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/oauth/kakao/callback",
    );

    await kakao.returns({ error: "access_denied" });

    await expect(page).toHaveURL(S09_1);
    const response = await (await callback).response();
    const setCookies = (await response!.headersArray())
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value);
    expect(setCookies.some((value) => value.startsWith(`${KAKAO_NOTICE_COOKIE}=`))).toBe(false);
    await expect(linkedDialog(page)).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test("연결한 이메일 회원은 [연결 해제] → 확인 모달 → [해제하기]로 2.13을 부르고 '연결하기'로 바뀐다", async ({
    page,
    msw,
  }) => {
    const calls = accountServer(msw, "KAKAO");
    await page.goto(S09_1);
    await expect(account(page).getByText("연결됨")).toBeVisible();
    await hydrated(unlinkButton(page));

    await unlinkButton(page).click();
    await expect(confirmDialog(page)).toContainText("켜 둔 연습 알림도 꺼져요");
    await expect(confirmDialog(page).getByRole("button", { name: "취소" })).toBeFocused();
    await confirmDialog(page).getByRole("button", { name: "해제하기" }).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(linkRow(page)).toBeFocused();
    expect(calls).toEqual(["DELETE"]);
  });

  test("확인 모달에서 [취소]하면 해제하지 않는다", async ({ page, msw }) => {
    const calls = accountServer(msw, "KAKAO");
    await page.goto(S09_1);
    await hydrated(unlinkButton(page));

    await unlinkButton(page).click();
    await confirmDialog(page).getByRole("button", { name: "취소" }).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(unlinkButton(page)).toBeFocused();
    expect(calls).toEqual([]);
  });
});
