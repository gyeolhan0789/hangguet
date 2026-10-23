import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { PROBLEM, REPLAY, RESULT, SESSION_INTERVIEW } from "./mocks/data";
import { api, expect, http, HttpResponse, problemResponse, test } from "./test";

// S07-1 면접 다시보기
// 근거: Figma S07-1(18:4478) · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당 질문 시점으로 점프, 재생 중인 질문 강조
//   + 자막 동기화, 채팅은 영상 대신 대화 기록) · 모션 메모 S07-1(18:4573) · Swagger 6.4 다시보기 200 예시
//   · 웹 Swagger 6.4 · 자막은 재생 위치가 속한 질문의 answer
//   · 사용자 결정(2026-10-22: 질문 카드를 펼치면 맨 위로 올라가고 아래에 답변, 다시 누르면 목록으로, 영상이 없으면 질문 목록만)
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
  test("채팅(영상 없음): 플레이어 없이 질문 목록만 보여 주고, 카드를 누르면 답변을 펼친다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, mode: "CHAT", videoUrl: null }),
      ),
    );
    await page.goto(S07_1);
    await expect(page.getByRole("heading", { name: "질문" })).toBeVisible();

    await expect(page.getByLabel("녹화 영상")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "재생", exact: true })).toHaveCount(0);

    await card(page, "대용량 트래픽 처리").click();

    await expect(card(page, "대용량 트래픽 처리")).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("region", { name: "질문" }).getByText("읽기 부하는 캐시로…"),
    ).toBeVisible();
  });
  test("접으면 답변 칸이 먼저 접히고, 카드가 흔들린 뒤, 목록('질문' 머리)이 돌아온다", async ({
    page,
    msw,
  }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, mode: "CHAT", videoUrl: null }),
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

  test("'‹ 결과로'를 누르면 S07 피드백 결과로 돌아간다", async ({ page, msw }) => {
    msw.use(
      http.get(api("/interview-sessions/:sessionId/replay"), () =>
        HttpResponse.json({ ...REPLAY, videoUrl: null }),
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
