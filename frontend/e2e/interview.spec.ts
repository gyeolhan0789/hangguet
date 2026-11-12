// S06 면접 진행(화상) · S06-B(채팅) · S06-E 종료 확인 · S06-1 결과 분석 중
// 기준: Figma S06(18:2497) · S06-B(18:2574) · S06-E(18:4226) · S06-1(18:4437) · Figma 흐름 S06 → S07 · S06-E → S06-1
//   · 웹 Swagger 5.2 면접 조회 · 5.4 면접 시작 · 5.5 지금 질문(202 다음 질문 생성 중) · 5.7 답변 제출 · 5.8 면접 끝내기 · 5.14 면접방 입장
//   · 사용자 요청 2026-10-27(모바일 크기 음성 인식 상자)
// 실제 브라우저에서만 확인되는 것만 둔다: page.tsx의 상태별 이동 · 실제 레이아웃.
// 화면 부품의 문구 · 분기는 컴포넌트 테스트, 서버 액션의 응답별 처리는 interview/actions.test.ts가 본다.
// 실제 LiveKit 방 · 에이전트에 붙는 확인은 E2E 밖이다. 면접방 메시지에 대한 반응은 use-interview-room 단위가 본다.

import type { Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import type { QuestionResponse, SessionResponse } from "../src/types/api";

import { routeInterviewerModel } from "./mocks/interviewer-model";
import {
  PROBLEM,
  QUESTION_CURRENT,
  QUESTION_GENERATING,
  SESSION_ENDED,
  SESSION_INTERVIEW,
  SESSION_PLAN,
} from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

const S06 = `/interview/${SESSION_INTERVIEW.IN_PROGRESS.id}`;

test.use({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  },
  permissions: ["camera", "microphone"],
});

/** 5.5 응답: 질문이면 200, null이면 202 다음 질문 생성 중 */
const questionResponse = (question: QuestionResponse | null) =>
  question ? HttpResponse.json(question) : HttpResponse.json(QUESTION_GENERATING, { status: 202 });

/** 5.2는 늘 이 면접, 5.5는 늘 이 응답으로 답한다 */
function interviewIs(
  msw: MswFixture,
  session: SessionResponse,
  current: () => Response = () => questionResponse(QUESTION_CURRENT),
) {
  msw.use(
    http.get(api("/interview-sessions/:sessionId"), () => HttpResponse.json(session)),
    http.get(api("/interview-sessions/:sessionId/questions/current"), current),
  );
}

/** 5.5를 부르면 500. 부르면 서버 컴포넌트가 던져 화면을 그리지 못한다(5.5를 부르지 않아야 하는 상태에서 쓴다) */
const questionFails = () => problemResponse(PROBLEM.INTERNAL_ERROR);

/**
 * 면접방 입장 정보(5.14)에 답하지 않아 연결 중으로 둔다. 입장이 실패하면 '면접이 잠시 멈췄어요' 카드가 화면을 가리고
 * 끊김 때 다시 그리므로, 뒤에 서버 액션이 없는 화상 test에서 쓴다(이 요청이 서버 액션을 붙잡는다).
 * 뒤에 서버 액션이 있으면 roomStaysConnecting을 쓴다.
 */
function holdRoom(msw: MswFixture) {
  msw.use(
    http.post(api("/interview-sessions/:sessionId/room-token"), () => new Promise<never>(() => {})),
  );
}

const question = (page: Page) => page.getByRole("region", { name: "악마 면접관 질문" });
const chatWaiting = (page: Page) =>
  page.getByRole("region", { name: "면접관이 면접을 준비하고 있어요" });
const analyzingTitle = (page: Page) =>
  page.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" });

test.describe("S06 · 면접 진행", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test.describe("면접 주소 분기", () => {
    test.describe("화면 표시", () => {
      test("화상 면접 중(5.2 VIDEO · IN_PROGRESS)에 들어오면 5.5 지금 질문으로 면접방을 그린다", async ({
        page,
        msw,
      }) => {
        await routeInterviewerModel(page, "missing");
        const calls = { session: 0, question: 0 };
        msw.use(
          http.get(api("/interview-sessions/:sessionId"), () => {
            calls.session++;
            return HttpResponse.json(SESSION_INTERVIEW.IN_PROGRESS);
          }),
          http.get(api("/interview-sessions/:sessionId/questions/current"), () => {
            calls.question++;
            return HttpResponse.json(QUESTION_CURRENT);
          }),
        );
        // 끊김 때의 다시 그리기를 막는다. 질문이 있는 화상 면접 중에는 다시 조회하지 않는다.
        holdRoom(msw);
        await page.goto(S06);

        await expect(question(page)).toContainText(QUESTION_CURRENT.content);
        // 한 번 열면 5.2 · 5.5를 한 번씩만 부른다(page.tsx의 connection()). 화면으로 관찰할 수 없는 FE 중복 호출 방지라
        // 호출 횟수를 센다(7-E 예외, 결정 room 3).
        expect(calls).toEqual({ session: 1, question: 1 });
      });

      test("결과 분석 중(5.2 ANALYZING)에 들어오면 5.5를 부르지 않고 S06-1 결과 분석 화면을 그린다", async ({
        page,
        msw,
      }) => {
        await routeInterviewerModel(page, "missing");
        interviewIs(msw, SESSION_INTERVIEW.ANALYZING, questionFails);
        await page.goto(S06);

        await expect(analyzingTitle(page)).toBeVisible();
        await expect(page).toHaveURL(S06);
      });

      test("시작 전 채팅 면접(5.2 CHAT · READY · GENERATING)에 들어오면 S05로 보내지 않고 5.5 없이 대기 화면을 그린다", async ({
        page,
        msw,
      }) => {
        await routeInterviewerModel(page, "empty");
        interviewIs(msw, { ...SESSION_PLAN.GENERATING, mode: "CHAT" }, questionFails);
        await page.goto(S06);

        await expect(chatWaiting(page)).toBeVisible();
        await expect(page).toHaveURL(S06);
      });

      test("결과가 나온 면접(5.2 COMPLETED)에 들어오면 S07 결과로 보낸다", async ({
        page,
        msw,
      }) => {
        await routeInterviewerModel(page, "missing");
        interviewIs(msw, SESSION_INTERVIEW.COMPLETED);
        await page.goto(S06);

        await expect(page).toHaveURL(`/interview/${SESSION_INTERVIEW.COMPLETED.id}/result`);
      });

      test("답변 없이 끝난 면접(5.2 ABORTED)에 들어오면 홈으로 보낸다", async ({ page, msw }) => {
        await routeInterviewerModel(page, "missing");
        interviewIs(msw, SESSION_ENDED.ABORTED);
        await page.goto(S06);

        await expect(page).toHaveURL("/home");
      });

      test("시작 전 화상 면접(5.2 VIDEO · READY)에 들어오면 S05 장치 점검으로 보낸다", async ({
        page,
        msw,
      }) => {
        await routeInterviewerModel(page, "missing");
        interviewIs(msw, SESSION_PLAN.READY);
        await page.goto(S06);

        await expect(page).toHaveURL(`/practice/devices?sessionId=${SESSION_PLAN.READY.id}`);
      });
    });

    test.describe("입력 검증", () => {
      test("주소의 면접 번호가 양의 정수가 아니면 면접을 조회하지 않고 S03 지원서 선택으로 보낸다", async ({
        page,
        msw,
      }) => {
        await routeInterviewerModel(page, "missing");
        // 조회했다면 면접방이 그려져 S03으로 가지 않는다.
        interviewIs(msw, SESSION_INTERVIEW.IN_PROGRESS);
        holdRoom(msw);
        await page.goto("/interview/abc");

        await expect(page).toHaveURL("/practice");
      });
    });

    test.describe("오류 처리", () => {
      test("없는 면접(5.2 404 SESSION_NOT_FOUND)이면 S03 지원서 선택으로 보낸다", async ({
        page,
        msw,
      }) => {
        await routeInterviewerModel(page, "missing");
        msw.use(
          http.get(api("/interview-sessions/:sessionId"), () =>
            problemResponse(PROBLEM.SESSION_NOT_FOUND),
          ),
        );
        await page.goto(S06);

        await expect(page).toHaveURL("/practice");
      });
    });
  });
});
