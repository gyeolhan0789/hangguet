import type { Locator, Page } from "@playwright/test";
import type { MswFixture } from "next/experimental/testmode/playwright/msw";

import type {
  AnalysisStep,
  AnswerRequest,
  QuestionResponse,
  SessionResponse,
} from "../src/types/api";

import {
  ANSWER,
  PROBLEM,
  QUESTION_CURRENT,
  QUESTION_GENERATING,
  SESSION_ENDED,
  SESSION_INTERVIEW,
  SESSION_PLAN,
  SESSION_STARTED,
} from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S06 면접 진행(화상) · S06-B(채팅) · S06-E 종료 확인 · S06-1 결과 분석 중
// 근거: Figma S06(18:2497) · S06-B(18:2574) · S06-E(18:4226) · S06-1(18:4437) · 기획 · 모션 메모 S06 · S06-B · S06-E · S06-1
//   · Swagger 5.2 면접 조회 · 5.4 면접 시작(채팅은 질문 준비가 끝나면 자동) · 5.5 지금 질문(202 다음 질문 생성 중)
//   · 5.7 답변 제출(TEXT · Idempotency-Key) · 5.8 면접 끝내기(202 ANALYZING · 200 ABORTED)
//   · 웹 Swagger 5.2 · 5.5(2초마다(임시 값) 다시 확인 — 다음 질문 5.5, 질문 준비 · 결과 분석 5.2) · 5.8(답변 0개 → 홈)
//   · 면접관 표현 결정 ③-3(실패 시 정지 이미지)
// 면접방 음성·리액션 메시지 처리는 use-interview-room.test.ts에서 검증한다.
// 서버 액션의 응답별 처리는 단위 테스트(interview/actions.test.ts), 화면 부품 · 시간 경계는 컴포넌트 테스트가 맡는다.
// 카메라 · 마이크는 Chromium 가짜 장치를, 3D는 SwiftShader(소프트웨어 WebGL)를 쓴다(새 headless 모드 channel: "chromium").
//
// 시간을 기다리는 단언은 두지 않는다:
// - mock은 "몇 번째 요청인가"가 아니라 테스트가 바꾸는 값을 돌려주고, 단계는 테스트가 단언한 뒤에 넘긴다.
// - 2초 다시 조회 · 1초 경과 시간은 Playwright Clock으로 시간을 직접 진행시킨다.
// - 3D는 시간 제한이 없고(사용자 결정 2026-10-22) 상태로만 끝나, 처리 시간만큼 기다린다.

const S06 = `/interview/${SESSION_INTERVIEW.IN_PROGRESS.id}`;
const GLB = "**/interview/devil/interviewer.glb";
/** 화면이 다음 질문 · 결과 분석을 다시 조회하는 간격(interview-room SESSION_POLL_MS) */
const POLL_MS = 2000;

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

/** 5.5 응답: 질문이면 200, null이면 202 QUESTION_GENERATING */
const questionResponse = (question: QuestionResponse | null) =>
  question ? HttpResponse.json(question) : HttpResponse.json(QUESTION_GENERATING, { status: 202 });

/** 5.2는 늘 이 면접, 5.5는 늘 이 질문으로 답한다. */
function interviewIs(
  msw: MswFixture,
  session: SessionResponse,
  question: QuestionResponse | null = QUESTION_CURRENT,
) {
  msw.use(
    http.get(api("/interview-sessions/:sessionId"), () => HttpResponse.json(session)),
    http.get(api("/interview-sessions/:sessionId/questions/current"), () =>
      questionResponse(question),
    ),
  );
}

/**
 * 면접방 입장 정보(5.14)에 답하지 않아 연결 중으로 둔다. 입장이 실패하면 S06-F '면접이 잠시 멈췄어요' 카드가 화면을 가리므로,
 * 면접방을 보지 않는 화상 테스트에서 쓴다(이 요청이 서버 액션을 붙잡으므로 뒤에 다시 조회 · 서버 액션 단계를 두지 않는다).
 */
function holdRoom(msw: MswFixture) {
  msw.use(
    http.post(api("/interview-sessions/:sessionId/room-token"), () => new Promise<never>(() => {})),
  );
}

/**
 * 3D 모델 대신 장면이 빈 아주 작은 GLB로 답한다. 모델을 '다 받은' 상태를 받는 시간 · 기기 성능과 무관하게 만든다
 * (채팅 대기 화면은 모델을 다 받아야 [면접 시작]을 보인다).
 */
function tinyModel(page: Page) {
  const json = Buffer.from(
    JSON.stringify({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 }),
  );
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const glb = Buffer.alloc(12 + 8 + padded.length);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);
  return page.route(GLB, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: glb }),
  );
}

/**
 * 3D 모델(32MB)을 받지 않게 404로 답한다. 404는 다시 받지 않아(retry.ts) 바로 정지 이미지가 나온다
 * (3D를 보는 테스트 밖에서 쓴다).
 */
const skip3d = (page: Page) => page.route(GLB, (route) => route.fulfill({ status: 404 }));

/** 다음 다시 조회(2초)를 기다리지 않고 바로 일으킨다. */
const nextPoll = (page: Page) => page.clock.fastForward(POLL_MS);

/**
 * 시계를 멈춘 채로 target이 보일 때까지 시간을 50ms씩 직접 진행한다.
 * (React가 스트리밍한 Suspense 내용을 보여 주는 것도 타이머라, 멈춘 시계에서는 진행시켜야 화면이 나온다)
 */
async function stepUntilVisible(page: Page, target: Locator) {
  await expect(async () => {
    await page.clock.runFor(50);
    await expect(target).toBeVisible({ timeout: 50 });
  }).toPass();
}

/** "08:42" 같은 분:초를 초로 바꾼다. */
const seconds = (text: string | null) => {
  const [minutes, rest] = (text ?? "").split(":").map(Number);
  return minutes * 60 + rest;
};

const stage = (page: Page) => page.getByTestId("interviewer-stage");
const question = (page: Page) => page.getByRole("region", { name: "악마 면접관 질문" });
const thinking = (page: Page) => page.getByRole("status", { name: "면접관이 생각하는 중" });
const endDialog = (page: Page) => page.getByRole("dialog", { name: "면접을 끝낼까요?" });
const answerBox = (page: Page) => page.getByRole("textbox", { name: "답변" });
const analyzingTitle = (page: Page) =>
  page.getByRole("heading", { name: "면접관이 답변을 검토하고 있어요" });
const currentStep = (page: Page) =>
  page.getByRole("listitem").and(page.locator('[aria-current="step"]'));

/**
 * 5.7 요청을 모아 둔다. 5.5는 state.question을 돌려준다(null이면 202 다음 질문 생성 중).
 * 답변을 받으면 state.question을 null로 바꾼다. 다음 질문은 테스트가 state.question을 바꿔 준다.
 */
function recordAnswers(
  msw: MswFixture,
  {
    session,
    first,
    answer = ANSWER,
  }: { session: SessionResponse; first: QuestionResponse; answer?: typeof ANSWER | object },
) {
  const state: { question: QuestionResponse | null } = { question: first };
  const requests: { body: AnswerRequest; key: string | null; questionId: string }[] = [];
  msw.use(
    http.get(api("/interview-sessions/:sessionId"), () => HttpResponse.json(session)),
    http.get(api("/interview-sessions/:sessionId/questions/current"), () =>
      questionResponse(state.question),
    ),
    http.post(
      api("/interview-sessions/:sessionId/questions/:questionId/answer"),
      async ({ request, params }) => {
        requests.push({
          body: (await request.json()) as AnswerRequest,
          key: request.headers.get("Idempotency-Key"),
          questionId: String(params.questionId),
        });
        state.question = null;
        return HttpResponse.json(answer, { status: 202 });
      },
    ),
  );
  return { requests, state };
}

/** 5.8 요청의 Idempotency-Key를 모아 두고 respond로 답한다. */
function recordEnds(msw: MswFixture, respond: () => Response) {
  const keys: (string | null)[] = [];
  msw.use(
    http.post(api("/interview-sessions/:sessionId/end"), ({ request }) => {
      keys.push(request.headers.get("Idempotency-Key"));
      return respond();
    }),
  );
  return keys;
}

/** 채팅 면접(Swagger 5.2 '면접 중' 예시의 방식만 CHAT으로 바꾼 것) */
const CHAT: SessionResponse = { ...SESSION_INTERVIEW.IN_PROGRESS, mode: "CHAT" };
/**
 * 다음 질문(304 · 4번). Swagger에 304번 질문 예시가 없어, 글은 5.2 예시의 질문 글을 빌려 쓴다
 * (Swagger는 5.2 · 5.5 예시의 303번 질문 글이 서로 다르다).
 */
const NEXT_QUESTION = {
  ...QUESTION_CURRENT,
  id: 304,
  seq: 4,
  content: "가장 큰 기술적 문제는 무엇이었나요?",
} satisfies QuestionResponse;

test.describe("S06 면접 화면", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("화상: 위 막대(면접관 · 회사 직무 · 질문 3 / 5 · 경과 시간) · 질문(5.5) · 내 카메라 · 음파 · [답변 완료]를 보여 준다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    interviewIs(msw, SESSION_INTERVIEW.IN_PROGRESS);
    // 시계를 멈춰 두고 경과 시간을 직접 진행한다.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.goto(S06);
    const time = page.locator("time");
    await stepUntilVisible(page, time);

    await expect(page).toHaveTitle("면접 · 한끗");
    await expect(page.getByText("악마 면접관", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("○○전자 백엔드 개발자")).toBeVisible();
    await expect(page.getByText("질문 3 / 5")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "질문 진행" })).toHaveAttribute(
      "aria-valuenow",
      "3",
    );
    // 5.2 elapsedSeconds 522초(08:42)에서 시작해 1초마다 는다. 화면을 보여 주느라 진행한 시간만큼은 이미 늘었을 수 있어
    // 시작 값은 08:42 이상으로만 보고, 그 뒤로는 진행한 시간만큼 정확히 느는지 본다.
    const start = seconds(await time.textContent());
    expect(start).toBeGreaterThanOrEqual(522);
    await page.clock.runFor(1000);
    await expect(time).toHaveText(new Date((start + 1) * 1000).toISOString().slice(14, 19));
    await expect(question(page)).toContainText(QUESTION_CURRENT.content);
    // 내 카메라(오른쪽 위)와 '나' 칩
    const camera = page.getByLabel("내 카메라 화면");
    await expect(camera).toBeVisible();
    await expect(camera.locator("xpath=..").getByText("나", { exact: true })).toBeVisible();
    // 내 답변 상자 맨 아래 줄은 파형과 [답변 완료](사용자 요청 2026-10-27: 마이크 없음)
    await expect(page.getByTestId("waveform")).toBeVisible();
    await expect(page.getByRole("img", { name: "마이크 듣는 중" })).toHaveCount(0);
    // 내 답변 자막이 없으면 누를 수 없다.
    await expect(page.getByRole("button", { name: "답변 완료" })).toBeDisabled();
    // 화상에는 채팅 입력창이 없다.
    await expect(answerBox(page)).toHaveCount(0);
  });

  test("화상: 눈 버튼으로 화면을 숨기면 면접관 · [면접 종료] · [화면 보이기]만 남고, 다시 누르면 돌아온다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    interviewIs(msw, SESSION_INTERVIEW.IN_PROGRESS);
    holdRoom(msw);
    await page.clock.install();
    await page.goto(S06);
    await stepUntilVisible(page, question(page));

    // 숨기기 전에는 모두 보인다(없는 요소는 toBeHidden도 통과하므로 먼저 본다)
    const parts = [
      question(page),
      page.getByLabel("내 카메라 화면").locator("xpath=..").getByText("나", { exact: true }),
      page.getByRole("region", { name: "내 답변 음성 인식" }),
      page.getByTestId("waveform"),
      page.getByRole("button", { name: "답변 완료" }),
      page.getByText("질문 3 / 5"),
    ];
    for (const part of parts) await expect(part).toBeVisible();

    // 사용자 요청(2026-10-27: 실제 면접처럼 듣기만으로 연습 — 입력 · 출력 · 질문 · 카메라를 모두 숨기고 눈 버튼과 [면접 종료]만)
    await page.getByRole("button", { name: "화면 숨기기" }).click();
    await expect(question(page)).toBeHidden();
    await expect(page.getByLabel("내 카메라 화면")).toBeHidden();
    await expect(page.getByRole("region", { name: "내 답변 음성 인식" })).toBeHidden();
    await expect(page.getByTestId("waveform")).toBeHidden();
    await expect(page.getByText("질문 3 / 5")).toBeHidden();
    for (const part of parts) await expect(part).toBeHidden();
    await expect(stage(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "면접 종료" })).toBeVisible();
    const show = page.getByRole("button", { name: "화면 보이기" });
    await expect(show).toBeVisible();

    await show.click();
    for (const part of parts) await expect(part).toBeVisible();
    await expect(show).toHaveCount(0);
  });

  test("한 번 열 때 5.2 · 5.5를 한 번씩만 부른다", async ({ page, msw }) => {
    await skip3d(page);
    const calls: string[] = [];
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () => {
        calls.push("5.2");
        return HttpResponse.json(SESSION_INTERVIEW.IN_PROGRESS);
      }),
      http.get(api("/interview-sessions/:sessionId/questions/current"), () => {
        calls.push("5.5");
        return HttpResponse.json(QUESTION_CURRENT);
      }),
    );
    // 질문이 있는 면접 중에는 다시 조회하지 않으므로, 화면을 한 번 그리는 동안의 호출만 센다.
    await page.goto(S06);

    await expect(question(page)).toContainText(QUESTION_CURRENT.content);
    expect(calls).toEqual(["5.2", "5.5"]);
  });

  test("3D 면접관: 불러오는 동안 로딩 표시(면접관 썸네일)를 두고, 다 불러오면 폭풍 배경과 함께 3D로 그린다", async ({
    page,
    msw,
  }) => {
    interviewIs(msw, SESSION_INTERVIEW.IN_PROGRESS);
    let stormRequested = false;
    let interiorRequested = false;
    const coffeeAssets: string[] = [];
    page.on("request", (request) => {
      if (decodeURIComponent(request.url()).includes("/interview/coffee-chat/"))
        coffeeAssets.push(request.url());
      if (request.url().endsWith("/interview/devil/storm.mp4")) stormRequested = true;
      if (request.url().endsWith("/interview/devil/office.webp")) interiorRequested = true;
    });
    // 로딩 표시를 확인할 때까지 모델 응답을 붙잡아 둔다.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(GLB, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(S06);
    await expect(page.getByRole("status", { name: "면접관을 불러오는 중" })).toBeVisible();

    await expect(stage(page)).toHaveAttribute("data-state", "loading");
    await expect(page.getByRole("img", { name: "악마 면접관" })).toBeVisible();
    release();

    // 시간 제한이 없어 결과는 늘 ready다. 다만 SwiftShader는 32MB 모델 해석 · 셰이더 컴파일에 십수 초가 걸려
    // 기다리는 시간만 길게 둔다(제한과 겨루는 것이 아니라 처리 시간이다).
    await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    await expect(page.getByRole("status", { name: "면접관을 불러오는 중" })).toHaveCount(0);
    await expect(stage(page).locator("canvas")).toBeVisible();
    // 악마 면접관은 폭풍 배경(먹구름 번개 영상 · 창문이 뚫린 실내 그림 · 비네트)을 깐다.
    await expect(page.getByTestId("storm-vignette")).toBeVisible();
    expect(stormRequested).toBe(true);
    expect(interiorRequested).toBe(true);
    // 커피챗의 카페 배경 · 조명은 악마 장면에 쓰지 않는다.
    expect(coffeeAssets).toEqual([]);
  });

  test("3D를 불러오지 못하면 면접관 정지 이미지를 보여 준다", async ({ page, msw }) => {
    await skip3d(page);
    interviewIs(msw, SESSION_INTERVIEW.IN_PROGRESS);
    await page.goto(S06);

    await expect(stage(page)).toHaveAttribute("data-state", "failed");
    await expect(stage(page).locator('img[src="/interview/devil/still.webp"]')).toBeVisible();
  });

  test("채팅: Enter로 답변(5.7 TEXT · 멱등 키)을 내면 면접관이 생각하는 중이 되고, 5.5로 다음 질문이 오면 바뀐다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    const { requests, state } = recordAnswers(msw, { session: CHAT, first: QUESTION_CURRENT });
    await page.clock.install();
    await page.goto(S06);

    await expect(page.getByText("Enter 전송 · Shift + Enter 줄바꿈 · 0 / 1,000")).toBeVisible();
    await expect(page.getByLabel("내 카메라 화면")).toHaveCount(0);
    await answerBox(page).fill("캐시 무효화 순서를 바꿨어요");
    await answerBox(page).press("Shift+Enter");
    await answerBox(page).pressSequentially("40% 줄였어요");
    await expect(page.getByText("Enter 전송 · Shift + Enter 줄바꿈 · 24 / 1,000")).toBeVisible();
    await answerBox(page).press("Enter");

    await expect(thinking(page)).toBeVisible();
    await expect(answerBox(page)).not.toBeEditable();
    // 막는 동안에도 입력칸 포커스(주황 테두리)를 잃지 않는다(사용자 요청 2026-10-27)
    await expect(answerBox(page)).toBeFocused();
    expect(requests).toHaveLength(1);
    expect(requests[0].questionId).toBe("303");
    expect(requests[0].body).toEqual({
      inputType: "TEXT",
      content: "캐시 무효화 순서를 바꿨어요\n40% 줄였어요",
    } satisfies AnswerRequest);
    expect(requests[0].key).toMatch(/^[0-9a-f-]{36}$/);

    // 다음 질문을 만드는 중(5.5 202)인 동안 다시 조회해도 생각 중이다.
    await nextPoll(page);
    await expect(thinking(page)).toBeVisible();

    // 다음 질문이 생기면, 다음 다시 조회에서 받는다.
    state.question = NEXT_QUESTION;
    await nextPoll(page);
    // 다음 질문 말풍선이 아래에서 올라오고, 생각 중 말풍선은 위로 사라진다.
    await expect(question(page).filter({ hasText: NEXT_QUESTION.content })).toBeVisible();
    await expect(question(page)).toHaveCount(1);
    await expect(page.getByText("질문 4 / 5")).toBeVisible();
    await expect(answerBox(page)).toBeEditable();
    await expect(answerBox(page)).toBeFocused();
    await expect(answerBox(page)).toHaveValue("");

    // 말풍선의 꺾쇠로 지금 질문을 한 줄로 접는다(사용자 요청 2026-10-27).
    await page.getByRole("button", { name: "질문 접기" }).click();
    await expect(page.getByRole("button", { name: "질문 펼치기" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("채팅: 마지막 질문에 답하면 이어서 면접을 끝내고(5.8) S06-1 결과 분석 중으로 바뀐다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    recordAnswers(msw, {
      session: CHAT,
      first: { ...QUESTION_CURRENT, seq: 5 },
      answer: { ...ANSWER, isLastQuestion: true },
    });
    // 5.8을 받은 뒤에만 5.2가 결과 분석 중(Swagger 5.2 'S06-1 결과 분석 중' 예시)을 준다.
    let ended = false;
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json(ended ? { ...SESSION_INTERVIEW.ANALYZING, mode: "CHAT" } : CHAT),
      ),
    );
    const ends = recordEnds(msw, () => {
      ended = true;
      return HttpResponse.json({ ...SESSION_ENDED.ANALYZING, mode: "CHAT" }, { status: 202 });
    });
    await page.goto(S06);

    await answerBox(page).fill("마지막 답변이에요");
    await answerBox(page).press("Enter");

    await expect(analyzingTitle(page)).toBeVisible();
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("채팅: 질문 준비 중(5.2 READY · GENERATING)이면 대기 화면(탑 쌓기)으로 기다리고, 준비가 끝나면 [면접 시작]으로 시작(5.4)한다", async ({
    page,
    msw,
  }) => {
    // 대기 화면은 면접관 모델까지 다 받아야 [면접 시작]을 보인다. 실제 모델(32MB) 대신 빈 장면의 작은 GLB로 답한다.
    await tinyModel(page);
    // 5.2는 테스트가 바꾸는 상태를 준다: 준비 중 → (테스트가 바꿈) 준비 완료 → (5.4를 받으면) 면접 중.
    // 질문 준비 예시(Swagger 5.2 'S05·S05-E 질문 준비 78%')의 방식만 CHAT으로 바꾼 것
    const state = { plan: "GENERATING" as keyof typeof SESSION_PLAN, started: false };
    let polls = 0;
    const keys: (string | null)[] = [];
    // 면접방 입장 토큰(5.14)을 요청한 때 면접이 시작돼 있었는지. RTC 연결은 하지 않도록 409로 답한다.
    const roomRequests: boolean[] = [];
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () => {
        polls++;
        return HttpResponse.json(
          state.started ? CHAT : { ...SESSION_PLAN[state.plan], mode: "CHAT" },
        );
      }),
      http.post(api("/interview-sessions/:sessionId/start"), ({ request }) => {
        keys.push(request.headers.get("Idempotency-Key"));
        state.started = true;
        return HttpResponse.json({ ...SESSION_STARTED, mode: "CHAT" });
      }),
      http.post(api("/interview-sessions/:sessionId/room-token"), () => {
        roomRequests.push(state.started);
        return problemResponse({
          title: "Conflict",
          status: 409,
          code: "INVALID_SESSION_STATE",
          detail: "지금은 할 수 없는 요청이에요.",
        });
      }),
    );
    await page.clock.install();
    await page.goto(S06);

    await expect(
      page.getByRole("region", { name: "면접관이 면접을 준비하고 있어요" }),
    ).toBeVisible();
    await expect(page.getByText("간단한 게임으로 긴장을 풀어볼까요?")).toBeVisible();
    await expect(answerBox(page)).not.toBeEditable();
    // 준비 중이면 다시 조회해도 시작하지 않는다.
    const before = polls;
    await nextPoll(page);
    await expect.poll(() => polls).toBeGreaterThan(before);
    expect(keys).toHaveLength(0);
    // 시작 전에는 면접방에 들어가지 않는다(5.14는 면접 중에만 된다).
    expect(roomRequests).toHaveLength(0);

    // 준비가 끝나면 [면접 시작]을 누르기 전에 5.4를 한 번 미리 부른다(선로딩). 면접방에는 누를 때 들어가 첫 질문을 받는다.
    state.plan = "READY";
    await nextPoll(page);
    const start = page.getByRole("button", { name: "면접 시작" });
    await expect(page.getByText("면접 준비에 실패했어요")).toHaveCount(0);
    await stepUntilVisible(page, start);
    expect(keys).toHaveLength(1);
    expect(roomRequests).toHaveLength(0);
    await start.click();
    await nextPoll(page);
    await expect(question(page).filter({ hasText: QUESTION_CURRENT.content })).toBeVisible();
    await expect(question(page)).toHaveCount(1);
    await expect(answerBox(page)).toBeEditable();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    // 면접이 시작되면 송출 없이 면접방에 들어간다(Swagger 5.4: 채팅도 면접방에 들어간다).
    // 입장 정보를 받지 못하면(409) 2초 뒤 다시 들어가고, 연달아 3번까지만 한다(처음 1번 + 다시 3번).
    // 다시 들어가는 때는 시계에 달려 있으므로 중간 횟수는 보지 않고, 시계를 충분히 진행한 뒤의 결과만 본다.
    // 확인할 때마다 시계를 2초 진행한다(앞 시도의 응답이 와야 다음 2초가 걸리므로 한 번에 몰아 진행하지 않는다).
    await expect
      .poll(
        async () => {
          await nextPoll(page);
          return roomRequests;
        },
        { timeout: 15_000 },
      )
      .toEqual([true, true, true, true]);
    await nextPoll(page);
    await nextPoll(page);
    expect(roomRequests).toEqual([true, true, true, true]);
  });

  test("[면접 종료] → S06-E: 답변한 질문 수 · 스트릭 인정을 알리고, [계속하기] · Esc로 닫힌다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    interviewIs(msw, SESSION_INTERVIEW.IN_PROGRESS);
    holdRoom(msw);
    const ends = recordEnds(msw, () => HttpResponse.json(SESSION_ENDED.ANALYZING, { status: 202 }));
    await page.goto(S06);

    await page.getByRole("button", { name: "면접 종료" }).click();
    await expect(endDialog(page)).toContainText("지금 끝내면 답변한 2개 질문까지만");
    await expect(endDialog(page)).toContainText("오늘 스트릭은 인정돼요");
    await expect(endDialog(page).getByRole("button", { name: "계속하기" })).toBeFocused();
    await endDialog(page).getByRole("button", { name: "계속하기" }).click();
    await expect(endDialog(page)).toHaveCount(0);

    await page.getByRole("button", { name: "면접 종료" }).click();
    await expect(endDialog(page).getByRole("button", { name: "계속하기" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(endDialog(page)).toHaveCount(0);
    expect(ends).toHaveLength(0);
  });

  test("S06-E [끝내기] → 5.8(202 ANALYZING) → S06-1, 다시 조회(5.2)할 때마다 분석 단계를 따라간다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    // 끝낸 뒤 5.2는 Swagger 'S06-1 결과 분석 중' 예시에서 분석 단계만 테스트가 정한 값으로 바꿔 준다.
    const state: { ended: boolean; step: AnalysisStep } = {
      ended: false,
      step: "ORGANIZING_ANSWERS",
    };
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json(
          state.ended
            ? { ...SESSION_INTERVIEW.ANALYZING, analysisStep: state.step }
            : SESSION_INTERVIEW.IN_PROGRESS,
        ),
      ),
    );
    const ends = recordEnds(msw, () => {
      state.ended = true;
      return HttpResponse.json(SESSION_ENDED.ANALYZING, { status: 202 });
    });
    await page.clock.install();
    await page.goto(S06);

    await page.getByRole("button", { name: "면접 종료" }).click();
    await endDialog(page).getByRole("button", { name: "끝내기" }).click();

    await expect(analyzingTitle(page)).toBeVisible();
    await expect(page.getByText("보통 10초 안에 끝나요")).toBeVisible();
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatch(/^[0-9a-f-]{36}$/);
    await expect(currentStep(page)).toHaveText("답변을 정리했어요");

    state.step = "SCORING";
    await nextPoll(page);
    await expect(currentStep(page)).toHaveText("평가 기준별로 분석하는 중…");

    state.step = "WRITING_FEEDBACK";
    await nextPoll(page);
    await expect(currentStep(page)).toHaveText("피드백을 쓰는 중");
    await expect(
      page.getByText("기다리는 동안 한 줄 팁 · 꼬리 질문엔 근거부터 짧게!"),
    ).toBeVisible();
  });

  test("답변 0개면 S06-E가 '결과 없이 나가요 · 스트릭 미인정'으로 알리고, 끝내면(200 ABORTED) 홈으로 간다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    // Swagger 5.2 '면접 중' 예시에서 답변 수 · 경과 시간만 5.8 '답변 0개' 예시 값으로 바꾼 것
    interviewIs(
      msw,
      { ...SESSION_INTERVIEW.IN_PROGRESS, answeredCount: 0, elapsedSeconds: 95 },
      { ...QUESTION_CURRENT, id: 301, seq: 1 },
    );
    recordEnds(msw, () => HttpResponse.json(SESSION_ENDED.ABORTED));
    await page.goto(S06);

    await page.getByRole("button", { name: "면접 종료" }).click();
    await expect(endDialog(page)).toContainText("결과 없이 나가요 · 스트릭 미인정");
    await expect(endDialog(page).getByText("오늘 스트릭은 인정돼요")).toHaveCount(0);
    await endDialog(page).getByRole("button", { name: "끝내기" }).click();

    await expect(page).toHaveURL("/home");
  });

  test("새로고침해도 결과 분석 중(5.2 ANALYZING)이면 S06-1을 그린다", async ({ page, msw }) => {
    await skip3d(page);
    interviewIs(msw, SESSION_INTERVIEW.ANALYZING, null);
    await page.goto(S06);

    await expect(analyzingTitle(page)).toBeVisible();
    await expect(currentStep(page)).toHaveText("평가 기준별로 분석하는 중…");
    await expect(page.getByRole("button", { name: "면접 종료" })).toHaveCount(0);
  });

  test("커피챗 면접관은 자기 3D 모델과 카페 배경으로 그리고, 폭풍 배경 · 번개 · 표시 아이콘은 없다", async ({
    page,
    msw,
  }) => {
    // 셰이더 컴파일(SwiftShader)까지 기다리므로 테스트 제한 시간을 늘린다.
    test.slow();
    const devilAssets: string[] = [];
    page.on("request", (request) => {
      if (decodeURIComponent(request.url()).includes("/interview/devil/"))
        devilAssets.push(request.url());
    });
    const coffeeModel = page.waitForResponse("**/interview/coffee-chat/interviewer.glb");
    const cafe = page.waitForResponse("**/interview/coffee-chat/cafe.webp");
    interviewIs(msw, { ...CHAT, persona: "COFFEE_CHAT" });
    await page.goto(S06);
    const [modelResponse, cafeResponse] = await Promise.all([coffeeModel, cafe]);
    expect(modelResponse.ok()).toBe(true);
    expect(cafeResponse.ok()).toBe(true);

    await expect(page.getByText("개발자 커피챗", { exact: true }).first()).toBeVisible();
    // 커피챗 모델은 작아(약 0.4MB) 금방 해석되지만, SwiftShader 셰이더 컴파일 시간만큼 기다린다.
    await expect(stage(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    await expect(stage(page).locator("canvas")).toBeVisible();
    expect(devilAssets).toEqual([]);
    await expect(page.getByTestId("lightning-flash")).toHaveCount(0);
    await expect(page.getByTestId("storm-vignette")).toHaveCount(0);
    await expect(page.locator('img[src*="icon-flame"]')).toHaveCount(0);
  });

  test("채팅: 질문 준비가 실패했으면(5.2 planStatus FAILED) '면접 준비에 실패했어요' · [다시 시도]를 보이고, 누르면 5.3으로 다시 준비한다", async ({
    page,
    msw,
  }) => {
    await skip3d(page);
    // Swagger 5.2 'S05 플랜 생성 실패' 예시의 방식만 CHAT으로 바꾼 것. 5.3을 받으면 다시 준비 중(GENERATING)이 된다.
    const state = { plan: "FAILED" as keyof typeof SESSION_PLAN };
    const retried: string[] = [];
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json({ ...SESSION_PLAN[state.plan], mode: "CHAT" }),
      ),
      http.post(api("/interview-sessions/:sessionId/plan/retry"), ({ params }) => {
        retried.push(String(params.sessionId));
        state.plan = "GENERATING";
        return HttpResponse.json(
          { ...SESSION_PLAN.GENERATING, mode: "CHAT", planProgress: 0 },
          { status: 202 },
        );
      }),
    );
    await page.goto(S06);

    const prepare = page.getByRole("region", { name: "면접 준비" });
    await expect(prepare).toContainText("면접 준비에 실패했어요");
    await expect(thinking(page)).toHaveCount(0);

    await prepare.getByRole("button", { name: "다시 시도" }).click();

    await expect(thinking(page)).toBeVisible();
    await expect(prepare).toHaveCount(0);
    expect(retried).toEqual([String(SESSION_PLAN.FAILED.id)]);
  });

  test("답변 없이 끝난 면접(5.2 ABORTED)에 들어오면 홈으로 보낸다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        HttpResponse.json(SESSION_ENDED.ABORTED),
      ),
    );
    await page.goto(S06);

    await expect(page).toHaveURL("/home");
  });

  test("시작 전 화상 면접(5.2 VIDEO · READY)에 들어오면 S05 장치 점검으로 보낸다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () => HttpResponse.json(SESSION_PLAN.READY)),
    );
    await page.goto(S06);

    await expect(page).toHaveURL(`/practice/devices?sessionId=${SESSION_PLAN.READY.id}`);
  });

  test("없는 면접(404 SESSION_NOT_FOUND)이면 S03 지원서 선택으로 보낸다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId"), () =>
        problemResponse(PROBLEM.SESSION_NOT_FOUND),
      ),
    );
    await page.goto(S06);

    await expect(page).toHaveURL("/practice");
  });
});
