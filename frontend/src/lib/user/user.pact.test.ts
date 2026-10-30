import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { getHome } from "@/lib/home/queries";
import { asMember, bearer, contract, oneOf, problem, providerValue, shape } from "@/test/pact";
import type {
  HomeResponse,
  MyStreakFreezesResponse,
  NicknameChangeResponse,
  PracticeLogsResponse,
  RecentReviewItem,
  StatsResponse,
  UploadUrlResponse,
} from "@/types/api";

import {
  applyStreakFreeze,
  changeNickname,
  changePassword,
  createProfileImageUploadUrl,
  deleteProfileImage,
  registerProfileImage,
  withdraw,
} from "./actions";
import { getPracticeLogs, getStats, getStreakFreezes } from "./queries";

// 기준: Swagger 2.2~2.7 회원 · 3.1~3.3 홈 · 통계 · 연습 달력 · 8.13~8.14 스트릭 유지권 예시
const { like, eachLike } = MatchersV3;
const CRITERIA = ["JOB_FIT", "COVER_LETTER", "LOGIC", "DELIVERY"] as const;
const pact = contract();

const passwordMismatch = { detail: "비밀번호가 맞지 않아요.", code: "PASSWORD_MISMATCH" };
const month = providerValue("month", "2026-10");

describe("회원", () => {
  it("2.2 닉네임을 바꾼다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.2 닉네임 변경")
      .withRequest("PATCH", "/api/v1/users/me", (b) =>
        b.headers(bearer).jsonBody({ nickname: "새 이름" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({ accessToken: "eyJ…", expiresIn: 3600 } satisfies Partial<NicknameChangeResponse>),
        ),
      )
      .executeTest(
        asMember(async () =>
          expect(await changeNickname({ nickname: "새 이름" })).toEqual({ ok: true }),
        ),
      ));

  it("2.3 비밀번호를 바꾼다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.3 비밀번호 변경")
      .withRequest("PATCH", "/api/v1/users/me/password", (b) =>
        b.headers(bearer).jsonBody({ currentPassword: "abcd1234", newPassword: "efgh5678" }),
      )
      .willRespondWith(200)
      .executeTest(
        asMember(async () =>
          expect(
            await changePassword({ currentPassword: "abcd1234", newPassword: "efgh5678" }),
          ).toEqual({ ok: true }),
        ),
      ));

  it("2.3 지금 비밀번호가 틀리면 칸 오류(400 PASSWORD_MISMATCH)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.3 틀린 지금 비밀번호로 변경")
      .withRequest("PATCH", "/api/v1/users/me/password", (b) =>
        b.headers(bearer).jsonBody({ currentPassword: "wrong1234", newPassword: "efgh5678" }),
      )
      .willRespondWith(400, (b) => problem(b, passwordMismatch))
      .executeTest(
        asMember(async () =>
          expect(
            await changePassword({ currentPassword: "wrong1234", newPassword: "efgh5678" }),
          ).toEqual({ fieldErrors: { currentPassword: "비밀번호가 맞지 않아요." } }),
        ),
      ));

  it("2.4 프로필 사진 업로드 주소를 받는다", () => {
    const upload = {
      uploadUrl: "https://…s3…?X-Amz-Signature=…",
      objectKey: "profile/1/7f3c….png",
    } satisfies Omit<UploadUrlResponse, "expiresAt">;
    return pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.4 프로필 사진 업로드 주소")
      .withRequest("POST", "/api/v1/users/me/profile-image/upload-url", (b) =>
        b.headers(bearer).jsonBody({ contentType: "image/png", size: 204800 }),
      )
      .willRespondWith(200, (b) => b.jsonBody(like(upload)))
      .executeTest(
        asMember(async () =>
          expect(
            await createProfileImageUploadUrl({ contentType: "image/png", size: 204800 }),
          ).toEqual({ upload }),
        ),
      );
  });

  it("2.5 올린 사진을 프로필 사진으로 등록한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("업로드한 프로필 사진")
      .uponReceiving("2.5 프로필 사진 등록")
      .withRequest("PUT", "/api/v1/users/me/profile-image", (b) =>
        b.headers(bearer).jsonBody({ objectKey: providerValue("objectKey", "profile/1/7f3c.png") }),
      )
      .willRespondWith(200)
      .executeTest(
        asMember(async () =>
          expect(await registerProfileImage("profile/1/7f3c.png")).toEqual({ ok: true }),
        ),
      ));

  it("2.5 발급받지 않은 키면 서버 문구(400 VALIDATION_FAILED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.5 발급받지 않은 키로 프로필 사진 등록")
      .withRequest("PUT", "/api/v1/users/me/profile-image", (b) =>
        b.headers(bearer).jsonBody({ objectKey: "profile/0/not-issued.png" }),
      )
      .willRespondWith(400, (b) =>
        problem(
          b,
          { detail: "입력값을 확인해 주세요.", code: "VALIDATION_FAILED" },
          { generic: true },
        ),
      )
      .executeTest(
        asMember(async () =>
          expect(await registerProfileImage("profile/0/not-issued.png")).toEqual({
            formError: "입력값을 확인해 주세요.",
          }),
        ),
      ));

  it("2.6 프로필 사진을 지운다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.6 프로필 사진 삭제")
      .withRequest("DELETE", "/api/v1/users/me/profile-image", (b) => b.headers(bearer))
      .willRespondWith(204)
      .executeTest(asMember(async () => expect(await deleteProfileImage()).toEqual({ ok: true }))));

  it("2.7 탈퇴하면 랜딩으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.7 회원 탈퇴")
      .withRequest("POST", "/api/v1/users/me", (b) =>
        b.headers(bearer).jsonBody({ password: "abcd1234" }),
      )
      .willRespondWith(204)
      .executeTest(
        asMember(() => expect(withdraw({ password: "abcd1234" })).rejects.toThrow(/^REDIRECT /)),
      ));

  it("2.7 비밀번호가 틀리면 칸 오류(400 PASSWORD_MISMATCH)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.7 틀린 비밀번호로 탈퇴")
      .withRequest("POST", "/api/v1/users/me", (b) =>
        b.headers(bearer).jsonBody({ password: "wrong1234" }),
      )
      .willRespondWith(400, (b) => problem(b, passwordMismatch))
      .executeTest(
        asMember(async () =>
          expect(await withdraw({ password: "wrong1234" })).toEqual({
            fieldErrors: { password: "비밀번호가 맞지 않아요." },
          }),
        ),
      ));
});

describe("홈 · 통계 · 연습 달력", () => {
  it("3.1 처음 온 회원의 홈(FIRST_VISIT)", () => {
    const home = {
      homeState: "FIRST_VISIT",
      currentStreak: 0,
      bestStreak: 0,
      practiceDates: [],
      todayInterviewCount: 0,
      todayPracticeMinutes: 0,
      todayImprovements: [],
      nextActions: [],
      nextActionsDate: null,
      recentReviews: [],
    } satisfies HomeResponse;
    return pact
      .addInteraction()
      .given("회원")
      .uponReceiving("3.1 처음 온 회원의 홈")
      .withRequest("GET", "/api/v1/home", (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody(shape(home, "homeState", "nextActionsDate", "currentStreak")),
      )
      .executeTest(asMember(async () => expect(await getHome()).toEqual(home)));
  });

  // 어제와 오늘 연습했다: 오늘 오른 기준이 있고, 최근 리뷰는 오늘(비교한 날 있음) · 어제(첫 연습일이라 null) 두 개다
  it("3.1 어제에 이어 오늘 연습한 회원의 홈(DONE_TODAY)", () => {
    const today = {
      practiceDate: "2026-10-15",
      companyName: "○○전자",
      criterion: "DELIVERY",
      delta: 8,
    } satisfies RecentReviewItem;
    const home = {
      homeState: "DONE_TODAY",
      currentStreak: 2,
      bestStreak: 2,
      practiceDates: ["2026-10-14", "2026-10-15"],
      todayInterviewCount: 1,
      todayPracticeMinutes: 18,
      todayImprovements: [{ criterion: "DELIVERY", delta: 8 }],
      nextActions: ["꼬리 질문엔 근거부터 짧게"],
      nextActionsDate: "2026-10-15",
      recentReviews: [
        today,
        { ...today, practiceDate: "2026-10-14", criterion: null, delta: null },
      ],
    } satisfies HomeResponse;
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT", previousDay: true })
      .uponReceiving("3.1 어제에 이어 오늘 연습한 회원의 홈")
      .withRequest("GET", "/api/v1/home", (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape(home, "homeState", "currentStreak"),
          practiceDates: eachLike("2026-10-15"),
          todayImprovements: eachLike({ criterion: oneOf(CRITERIA, "DELIVERY"), delta: like(8) }),
          nextActions: eachLike("꼬리 질문엔 근거부터 짧게"),
          recentReviews: [
            { ...shape(today), criterion: oneOf(CRITERIA, "DELIVERY") },
            shape(home.recentReviews[1], "criterion", "delta"),
          ],
        }),
      )
      .executeTest(asMember(async () => expect((await getHome()).homeState).toBe("DONE_TODAY")));
  });

  it("3.2 통계를 받는다", () => {
    const stats = {
      currentStreak: 1,
      bestStreak: 1,
      totalInterviewCount: 1,
      totalPracticeMinutes: 18,
      latestJobTitle: "백엔드 개발자",
    } satisfies StatsResponse;
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT" })
      .uponReceiving("3.2 통계")
      .withRequest("GET", "/api/v1/users/me/stats", (b) => b.headers(bearer))
      .willRespondWith(200, (b) => b.jsonBody(like(stats)))
      .executeTest(asMember(async () => expect(await getStats()).toEqual(stats)));
  });

  it("3.3 그달 연습 기록을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT" })
      .uponReceiving("3.3 연습 달력")
      .withRequest("GET", "/api/v1/practice-logs", (b) => b.headers(bearer).query({ month }))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          content: eachLike({ practiceDate: "2026-10-20" }),
        } satisfies Record<keyof PracticeLogsResponse, unknown>),
      )
      .executeTest(asMember(async () => expect(await getPracticeLogs("2026-10")).toBeTruthy())));
});

describe("스트릭 유지권", () => {
  const freezeId = providerValue("freezeId", 31);

  it("8.13 내 유지권을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("스트릭 유지권")
      .uponReceiving("8.13 내 스트릭 유지권")
      .withRequest("GET", "/api/v1/users/me/streak-freezes", (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody(
          like({
            availableCount: 1,
            freezes: eachLike({
              id: 31,
              fillableDate: "2026-10-19",
              expiresAt: "2026-11-03T00:00:00+09:00",
            }),
          } satisfies Record<keyof MyStreakFreezesResponse, unknown>),
        ),
      )
      .executeTest(
        asMember(async () => expect((await getStreakFreezes()).availableCount).toBe(1)),
      ));

  it("8.14 유지권으로 빠진 날을 메운다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("스트릭 유지권")
      .uponReceiving("8.14 유지권 사용")
      .withRequest("POST", "/api/v1/users/me/streak-freezes/use", (b) =>
        b.headers(bearer).jsonBody({ freezeId }),
      )
      // 화면은 성공 여부(used)만 본다
      .willRespondWith(200, (b) => b.jsonBody({}))
      .executeTest(
        asMember(async () => expect(await applyStreakFreeze(31)).toHaveProperty("used")),
      ));

  it("8.14 없는 유지권이면 서버 문구(404 STREAK_FREEZE_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("8.14 없는 유지권 사용")
      .withRequest("POST", "/api/v1/users/me/streak-freezes/use", (b) =>
        b.headers(bearer).jsonBody({ freezeId: 999999999 }),
      )
      .willRespondWith(404, (b) =>
        problem(
          b,
          {
            detail: "유지권을 찾을 수 없어요.",
            code: "STREAK_FREEZE_NOT_FOUND",
          },
          { generic: true },
        ),
      )
      .executeTest(
        asMember(async () =>
          expect(await applyStreakFreeze(999999999)).toEqual({ error: "유지권을 찾을 수 없어요." }),
        ),
      ));
});
