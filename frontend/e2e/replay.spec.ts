import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { PROBLEM, REPLAY, RESULT, SESSION_INTERVIEW } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S07-1 면접 다시보기
// 근거: Figma S07-1(18:4478) · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당 질문 시점으로 점프, 재생 중인 질문 강조
//   + 자막 동기화, 채팅은 영상 대신 대화 기록) · 모션 메모 S07-1(18:4573) · Swagger 6.4 다시보기 200 예시
//   · 웹 Swagger 6.4 · 자막은 재생 위치가 속한 질문의 answer
//   · 사용자 결정(2026-10-22: 질문 카드를 펼치면 맨 위로 올라가고 아래에 답변, 다시 누르면 목록으로)
//   · 사용자 결정(2026-10-27: 채팅도 영상 자리에 '채팅 면접은 녹화 영상이 없어요'를 둔다)
// 녹화 영상은 Swagger 예시 주소(…s3…)를 받을 수 없어, 같은 길이(18분)의 작은 테스트 영상(fixtures/replay.webm)으로 답한다.
// 화면 부품의 경계(재생 위치별 질문 · 배속 순서 등)는 컴포넌트 테스트(replay-view.test.tsx)가 맡는다.

const S07_1 = `/interview/${REPLAY.id}/replay`;
const VIDEO_URL = "https://video.test/sessions/55/session.webm";
const VIDEO = readFileSync(join(__dirname, "fixtures/replay.webm"));

/**
 * 테스트 영상을 녹화 영상 주소로 내준다. 브라우저는 재생 위치를 옮길 때 Range 요청을 보내므로, S3처럼 206 부분 응답으로 답한다
 * (Range를 받지 않으면 위치를 옮길 수 없는 영상으로 본다).
 */
function serveVideo(page: Page) {
  return page.route(VIDEO_URL, (route) => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? "");
    if (!range) {
      return route.fulfill({
        status: 200,
        contentType: "video/webm",
        headers: { "Accept-Ranges": "bytes" },
        body: VIDEO,
      });
    }
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : VIDEO.length - 1;
    return route.fulfill({
      status: 206,
      contentType: "video/webm",
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${VIDEO.length}`,
      },
      body: VIDEO.subarray(start, end + 1),
    });
  });
}

const card = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(name) });

test.describe("S07-1 면접 다시보기", () => {
  test.beforeEach(async ({ signIn }) => {
    await signIn();
  });

  test("화상: 질문 카드를 누르면 영상이 그 질문 시점으로 옮겨 가고, 카드가 맨 위에서 답변을 펼친다. 다시 누르면 목록으로 돌아간다", async ({
    page,
    msw,
  }) => {
    await serveVideo(page);
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoUrl: VIDEO_URL }),
      ),
    );
    await page.goto(S07_1);
    await expect(page.getByText("00:00 / 18:00")).toBeVisible();

    await card(page, "가장 큰 기술적 문제는").click();

    // 화면 숫자만이 아니라 실제 영상이 그 위치로 옮겨 갔는지 본다.
    await expect(page.getByLabel("녹화 영상")).toHaveJSProperty("currentTime", 372);
    await expect(page.getByText("06:12 / 18:00")).toBeVisible();
    await expect(page.getByLabel("자막")).toHaveText(
      "자막 · 06:12저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…",
    );
    await expect(card(page, "가장 큰 기술적 문제는")).toHaveAttribute("aria-expanded", "true");
    // 다른 질문 카드와 '질문 N개'는 빠지고, 펼친 카드 아래에 답변이 펼쳐진다.
    await expect(page.getByRole("heading", { name: "질문" })).toHaveCount(0);
    await expect(card(page, "1분 자기소개")).toHaveCount(0);
    const questions = page.getByRole("region", { name: "질문" });
    await expect(
      questions.getByText("저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…"),
    ).toBeVisible();

    await card(page, "가장 큰 기술적 문제는").click();

    await expect(page.getByRole("heading", { name: "질문" })).toBeVisible();
    await expect(questions.getByRole("button")).toHaveCount(5);
  });
  test("화상: [재생]으로 재생하고 [일시정지]로 멈추며, 배속 칩은 1x → 1.5x로 바꾼다", async ({
    page,
    msw,
  }) => {
    await serveVideo(page);
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoUrl: VIDEO_URL }),
      ),
    );
    await page.goto(S07_1);
    const video = page.getByLabel("녹화 영상");
    await expect(page.getByText("00:00 / 18:00")).toBeVisible();

    await page.getByRole("button", { name: "재생", exact: true }).click();
    await expect(page.getByRole("button", { name: "일시정지" })).toBeVisible();
    await expect(video).toHaveJSProperty("paused", false);

    await page.getByRole("button", { name: "일시정지" }).click();
    await expect(page.getByRole("button", { name: "재생", exact: true })).toBeVisible();
    await expect(video).toHaveJSProperty("paused", true);

    await page.getByRole("button", { name: "재생 속도 1x" }).click();
    await expect(page.getByRole("button", { name: "재생 속도 1.5x" })).toHaveText("1.5x");
    await expect(video).toHaveJSProperty("playbackRate", 1.5);
  });
  test("채팅(영상 없음): 영상 자리에 녹화 영상이 없다는 문구를 두고, 카드를 누르면 답변을 펼친다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, mode: "CHAT", videoStatus: null, videoUrl: null }),
      ),
    );
    await page.goto(S07_1);
    await expect(page.getByRole("heading", { name: "질문" })).toBeVisible();

    await expect(page.getByLabel("녹화 영상")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "재생", exact: true })).toHaveCount(0);
    await expect(page.getByText("채팅 면접은 녹화 영상이 없어요")).toBeVisible();

    await card(page, "대용량 트래픽 처리").click();

    await expect(card(page, "대용량 트래픽 처리")).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("region", { name: "질문" }).getByText("읽기 부하는 캐시로…"),
    ).toBeVisible();
  });
  // 사용자 결정(2026-10-28): 답하지 않은 질문(answer null)도 펼쳐 안내를 보여 주고, 다시 누르면 목록으로 접는다
  test("답하지 않은 질문: 펼치면 '답변하지 않은 질문이에요'를 보여 주고, 다시 누르면 목록으로 접는다", async ({
    page,
    msw,
  }) => {
    const items = REPLAY.items.map((item, i) =>
      i === 4 ? { ...item, answer: null, answerCreatedAt: null, grade: null } : item,
    );
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, mode: "CHAT", videoStatus: null, videoUrl: null, items }),
      ),
    );
    await page.goto(S07_1);
    const questions = page.getByRole("region", { name: "질문" });

    await card(page, "대용량 트래픽 처리").click();
    await expect(questions.getByText("답변하지 않은 질문이에요")).toBeVisible();

    await card(page, "대용량 트래픽 처리").click();
    await expect(card(page, "대용량 트래픽 처리")).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { name: "질문" })).toBeVisible();
    await expect(questions.getByRole("button", { expanded: false })).toHaveCount(5);
  });
  test("접으면 답변 칸이 먼저 접히고, 카드가 흔들린 뒤, 목록('질문' 머리)이 돌아온다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, mode: "CHAT", videoStatus: null, videoUrl: null }),
      ),
    );
    await page.goto(S07_1);
    await card(page, "대용량 트래픽 처리").click();
    const questions = page.getByRole("region", { name: "질문" });
    await expect(questions.getByText("읽기 부하는 캐시로…")).toBeVisible();

    // 시간이 아니라 일어난 순서만 기록한다(답변 칸이 빠짐 → 카드가 위아래로 움직임 → '질문' 머리가 다시 생김).
    await questions.evaluate((section) => {
      const log: string[] = [];
      (window as unknown as { closeLog: string[] }).closeLog = log;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node instanceof HTMLElement && node.id.startsWith("replay-answer-"))
              log.push("answer");
          }
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.querySelector("#replay-questions"))
              log.push("head");
          }
          const target = record.target;
          if (
            record.type === "attributes" &&
            target instanceof HTMLLIElement &&
            /translateY\((?!0px)/.test(target.style.transform)
          ) {
            log.push("wobble");
          }
        }
      }).observe(section, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    });

    await card(page, "대용량 트래픽 처리").click();
    await expect(page.getByRole("heading", { name: "질문" })).toBeVisible();

    const log = await page.evaluate(() => (window as unknown as { closeLog: string[] }).closeLog);
    expect(log.indexOf("answer")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("wobble")).toBeGreaterThan(log.indexOf("answer"));
    expect(log.indexOf("head")).toBeGreaterThan(log.indexOf("wobble"));
  });

  // 기준: API 명세 6.4 videoStatus(MERGING: 처리 중 안내 + 10초마다 다시 조회, FAILED: 불러오지 못함 안내) · S15P31A301-259
  test("화상 · 녹화 합치는 중(MERGING): 처리 중임을 알리고 10초마다 6.4를 다시 불러, 합치기가 끝나면(READY) 영상을 보여 준다", async ({
    page,
    msw,
  }) => {
    await serveVideo(page);
    // 6.4는 테스트가 바꾸는 상태를 준다: 합치는 중 → (테스트가 바꿈) 준비됨
    const state = { ready: false };
    let calls = 0;
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () => {
        calls++;
        return HttpResponse.json(
          state.ready
            ? { ...REPLAY, videoStatus: "READY", videoUrl: VIDEO_URL }
            : { ...REPLAY, videoStatus: "MERGING", videoUrl: null },
        );
      }),
    );
    // 시계를 깔고 10초를 직접 진행한다(10초 경계는 단위 테스트가 본다)
    await page.clock.install();
    await page.goto(S07_1);
    await expect(page.getByRole("status")).toHaveText("영상을 업로드하는 중이에요");
    await expect(page.getByLabel("녹화 영상")).toHaveCount(0);
    // 질문 목록과 답변은 보여 준다
    await card(page, "가장 큰 기술적 문제는").click();
    await expect(page.getByText(REPLAY.items[2].answer)).toBeVisible();

    const before = calls;
    state.ready = true;
    await page.clock.runFor(10_000);
    await expect.poll(() => calls).toBeGreaterThan(before);
    await expect(page.getByLabel("녹화 영상")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("화상 · 녹화 합치기 실패(FAILED): 불러오지 못했다고 알리고 질문 목록과 답변은 보여 준다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoStatus: "FAILED", videoUrl: null }),
      ),
    );
    await page.goto(S07_1);
    await expect(page.getByRole("status")).toHaveText("녹화를 불러오지 못했어요");
    await expect(page.getByLabel("녹화 영상")).toHaveCount(0);
    await card(page, "가장 큰 기술적 문제는").click();
    await expect(page.getByText(REPLAY.items[2].answer)).toBeVisible();
  });

  test("'‹ 결과로'를 누르면 S07 피드백 결과로 돌아간다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoStatus: "MERGING", videoUrl: null }),
      ),
      http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
    );
    await page.goto(S07_1);

    await page.getByRole("link", { name: "결과로" }).click();

    await expect(page).toHaveURL(`/interview/${REPLAY.id}/result`);
    await expect(page.getByRole("list", { name: "평가 기준" })).toBeVisible();
  });

  for (const [label, problem, to] of [
    [
      "면접이 없으면(6.4 404 SESSION_NOT_FOUND) S03 지원서 입력으로",
      PROBLEM.SESSION_NOT_FOUND,
      "/practice",
    ],
    ["결과가 없는 면접이면(6.4 409 NO_RESULT) S03 지원서 입력으로", PROBLEM.NO_RESULT, "/practice"],
    [
      "아직 분석 중이면(6.4 409 RESULT_NOT_READY) S06-1 결과 분석 중으로",
      PROBLEM.RESULT_NOT_READY,
      `/interview/${REPLAY.id}`,
    ],
  ] as const) {
    test(`${label} 보낸다`, async ({ page, msw }) => {
      await page.route("**/interview/devil/interviewer.glb", (route) =>
        route.fulfill({ status: 404 }),
      );
      msw.use(
        http.get(api("/interview-sessions/:sessionId/replay"), () => problemResponse(problem)),
        http.get(api("/interview-sessions/:sessionId"), () =>
          HttpResponse.json(SESSION_INTERVIEW.ANALYZING),
        ),
      );
      await page.goto(S07_1);

      await expect(page).toHaveURL(to);
    });
  }
});

// 모바일(sm 미만) 화상 다시보기(사용자 결정 2026-10-26): 영상 아래 자막은 빼고 질문 목록(펼치면 그 질문의 답변 = 스크립트)으로 보며,
// 영상 · 재생 막대는 위에 고정한 채 질문 목록만 스크롤한다. sm 이상은 그대로다.
// 채팅도 같은 배치로 영상 자리에 '채팅 면접은 녹화 영상이 없어요'를 둔다(사용자 결정 2026-10-27).
test.describe("S07-1 면접 다시보기 · 모바일", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ signIn, page, msw }) => {
    await signIn();
    await serveVideo(page);
    // 질문 목록이 화면보다 길어지도록(스크롤이 생기도록) 질문을 길게 둔다
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({
          ...REPLAY,
          videoUrl: VIDEO_URL,
          items: REPLAY.items.map((item) => ({ ...item, question: `${item.question} `.repeat(4) })),
        }),
      ),
    );
  });

  const questions = (page: Page) => page.getByRole("region", { name: "질문" });

  test("질문을 누르면 영상이 그 시점으로 가고 답변(스크립트)이 펼쳐지며, 영상 아래 자막은 보이지 않는다", async ({
    page,
  }) => {
    await page.goto(S07_1);
    await expect(page.getByText("00:00 / 18:00")).toBeVisible();

    await card(page, "가장 큰 기술적 문제는").click();

    await expect(page.getByLabel("녹화 영상")).toHaveJSProperty("currentTime", 372);
    await expect(card(page, "가장 큰 기술적 문제는")).toHaveAttribute("aria-expanded", "true");
    await expect(
      questions(page).getByText("저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…"),
    ).toBeVisible();
    // 자막 상자는 그려지되(질문이 정해짐) CSS로 숨는다
    await expect(page.getByRole("region", { name: "자막", includeHidden: true })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "자막", includeHidden: true })).toBeHidden();
  });

  test("페이지는 스크롤되지 않고, 질문 목록만 스크롤되며 영상은 제자리에 있다", async ({
    page,
  }) => {
    await page.goto(S07_1);
    await expect(page.getByText("00:00 / 18:00")).toBeVisible();
    const list = page.getByTestId("replay-questions-scroll");

    // 페이지 높이는 화면 높이를 넘지 않고, 질문 목록은 내용이 넘쳐 스크롤할 수 있다
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
      .toBeLessThanOrEqual(0);
    await expect
      .poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(0);

    // 마지막 질문까지 내려 볼 수 있고, 그동안 페이지는 그대로라 영상 · 재생 막대가 화면에 다 보인다
    await card(page, "대용량 트래픽 처리").scrollIntoViewIfNeeded();
    await expect(card(page, "대용량 트래픽 처리")).toBeInViewport();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByLabel("녹화 영상")).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("slider", { name: "재생 위치" })).toBeInViewport({ ratio: 1 });
  });

  test("녹화 합치는 중(MERGING): 안내 상자는 위에 고정되고 페이지는 스크롤되지 않으며 질문 목록만 스크롤된다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoStatus: "MERGING", videoUrl: null }),
      ),
    );
    await page.goto(S07_1);
    const notice = page.getByRole("status");
    await expect(notice).toHaveText("영상을 업로드하는 중이에요");
    const top = (await notice.boundingBox())!.y;
    const list = page.getByTestId("replay-questions-scroll");
    await list.evaluate((element) => element.scrollBy(0, 400));
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect((await notice.boundingBox())!.y).toBe(top);
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  });

  test("채팅: 영상 없음 문구는 위에 고정되고 페이지는 스크롤되지 않으며 질문 목록만 스크롤된다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, mode: "CHAT", videoStatus: null, videoUrl: null }),
      ),
    );
    await page.goto(S07_1);
    const notice = page.getByText("채팅 면접은 녹화 영상이 없어요");
    await expect(notice).toBeInViewport({ ratio: 1 });
    const top = (await notice.boundingBox())!.y;
    const list = page.getByTestId("replay-questions-scroll");
    await list.evaluate((element) => element.scrollBy(0, 400));
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect((await notice.boundingBox())!.y).toBe(top);
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  });
});

// 640px(sm)부터는 모바일 배치가 아니다(경계값). 넓은 화면은 기존 테스트(기본 1280)가 본다.
test.describe("S07-1 면접 다시보기 · sm 경계(640px)", () => {
  test.use({ viewport: { width: 640, height: 900 } });

  test("질문을 고르면 영상 아래 자막을 보여 준다", async ({ signIn, page, msw }) => {
    await signIn();
    await serveVideo(page);
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoUrl: VIDEO_URL }),
      ),
    );
    await page.goto(S07_1);
    await expect(page.getByText("00:00 / 18:00")).toBeVisible();

    await card(page, "가장 큰 기술적 문제는").click();
    await expect(page.getByRole("region", { name: "자막" })).toBeVisible();
  });
});
