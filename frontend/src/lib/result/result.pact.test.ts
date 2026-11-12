import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { getGrowthReview } from "@/lib/growth/queries";
import { getSessionCalendar, getSessionList } from "@/lib/records/queries";
import {
  asMember,
  bearer,
  contract,
  problem,
  providerPath,
  providerValue,
  sessionPath,
  oneOf,
  shape,
} from "@/test/pact";
import type {
  GrowthReviewResponse,
  ReplayResponse,
  ResultResponse,
  SessionListItem,
  TimelineMetric,
  TimelineReason,
} from "@/types/api";

import { getReplay, getResult } from "./queries";

// 기준: Swagger 5.13 연습 면접 목록 · 5.15 월별 횟수 · 6.3 면접 결과 · 6.4 다시보기(채팅 · 화상 READY) · 7.1 날짜별 성장 리뷰
// (첫 면접 · 오늘의 성장 리뷰) 예시. 6.4 화상 면접 말고는 결과가 나온 면접이 채팅 면접이다(화상 지표 · 녹화 없음).
const { like, eachLike } = MatchersV3;
const pact = contract();

const practiceDate = providerValue("practiceDate", "2026-10-15");
const criteria = ["JOB_FIT", "COVER_LETTER", "LOGIC", "DELIVERY"] as const;
const METRICS = [
  "STABILITY",
  "CONFIDENCE",
  "EXPRESSION",
  "EMOTION",
  "LIKEABILITY",
  "TRUST",
  "TRAILING_OFF",
  "FILLER",
  "LONG_PAUSE",
] as const satisfies readonly TimelineMetric[];

describe("연습 기록", () => {
  it("5.13 그날 본 면접 목록을 받는다", () => {
    const item = {
      id: 55,
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      persona: "DEVIL",
      mode: "CHAT",
      status: "COMPLETED",
      startedAt: "2026-10-15T12:00:00+09:00",
      endedAt: "2026-10-15T12:18:00+09:00",
      summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
    } satisfies Omit<SessionListItem, "criterionGrades" | "answeredCount">;
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT" })
      .uponReceiving("5.13 연습 면접 목록")
      .withRequest("GET", "/api/v1/interview-sessions", (b) =>
        b.headers(bearer).query({ practiceDate, page: "0", size: "5" }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          content: eachLike(shape(item, "status", "persona", "mode")),
          page: shape(
            { number: 0, totalElements: 1, totalPages: 1 },
            "number",
            "totalElements",
            "totalPages",
          ),
          summary: like({ totalInterviewCount: 1 }),
        }),
      )
      .executeTest(
        asMember(async () =>
          expect((await getSessionList("2026-10-15", 0)).content[0].status).toBe("COMPLETED"),
        ),
      );
  });

  it("5.15 그달 날짜별 면접 횟수를 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT" })
      .uponReceiving("5.15 월별 연습 면접 횟수")
      .withRequest("GET", "/api/v1/interview-sessions/calendar", (b) =>
        b.headers(bearer).query({ month: providerValue("month", "2026-10") }),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          content: eachLike({ practiceDate: "2026-10-15", interviewCount: 1 }),
        }),
      )
      .executeTest(asMember(async () => expect(await getSessionCalendar("2026-10")).toBeTruthy())));
});

describe("결과 · 다시보기", () => {
  it("6.3 면접 결과를 받는다", () => {
    const result = {
      id: 55,
      persona: "DEVIL",
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
      startedAt: "2026-10-15T12:00:00+09:00",
      endedAt: "2026-10-15T12:18:00+09:00",
      sessionScores: criteria.map((criterion) => ({ criterion, grade: "NORMAL" })),
      answers: [
        {
          questionId: 301,
          seq: 1,
          question: "1분 자기소개",
          grade: "GOOD",
          goodPoint: "핵심 경험을 1분 안에 정리했어요",
          improvePoint: "지원 동기가 마지막에 짧게만 나왔어요",
        },
      ],
    } satisfies Omit<ResultResponse, "mode" | "speechMetrics" | "sessionScores" | "answers"> & {
      sessionScores: Pick<ResultResponse["sessionScores"][number], "criterion" | "grade">[];
      answers: Omit<ResultResponse["answers"][number], "content" | "score">[];
    };
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT" })
      .uponReceiving("6.3 면접 결과")
      .withRequest("GET", sessionPath("/result"), (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape(result, "persona"),
          sessionScores: result.sessionScores.map((row) => shape(row, "criterion", "grade")),
          answers: eachLike(shape(result.answers[0], "grade")),
        }),
      )
      .executeTest(
        asMember(async () => expect(await getResult(55)).toMatchObject({ status: "ok" })),
      );
  });

  // 6.3 · 6.4는 같은 load()로 분석 중(RESULT_NOT_READY) · 결과 없음(NO_RESULT)을 나눈다
  const analyzing = { code: "RESULT_NOT_READY" };
  const noResult = { code: "NO_RESULT" };
  it.each([
    {
      name: "6.3 면접 결과",
      path: "/result",
      load: getResult,
      stage: "ANALYZING",
      error: analyzing,
      status: "analyzing",
    },
    {
      name: "6.3 면접 결과",
      path: "/result",
      load: getResult,
      stage: "ABORTED",
      error: noResult,
      status: "missing",
    },
    {
      name: "6.4 다시보기",
      path: "/replay",
      load: getReplay,
      stage: "ANALYZING",
      error: analyzing,
      status: "analyzing",
    },
    {
      name: "6.4 다시보기",
      path: "/replay",
      load: getReplay,
      stage: "ABORTED",
      error: noResult,
      status: "missing",
    },
  ])(
    "$name: $stage 면접이면 $status(409 $error.code)",
    ({ name, path, load, stage, error, status }) =>
      pact
        .addInteraction()
        .given("회원")
        .given("면접", { stage, mode: "CHAT" })
        .uponReceiving(`${name} ${stage} 면접`)
        .withRequest("GET", sessionPath(path), (b) => b.headers(bearer))
        .willRespondWith(409, (b) => problem(b, error))
        .executeTest(asMember(async () => expect(await load(55)).toEqual({ status }))),
  );

  it("6.4 채팅 면접 다시보기를 받는다", () => {
    const replay = {
      id: 55,
      persona: "DEVIL",
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      startedAt: "2026-10-15T12:00:00+09:00",
      // 채팅 면접은 녹화가 없어 null이다(API 명세 6.4)
      recordingStartedAt: null,
      videoStatus: null,
      videoUrl: null,
      items: [
        {
          questionId: 301,
          seq: 1,
          question: "1분 자기소개",
          questionCreatedAt: "2026-10-15T12:00:42+09:00",
          answer: "안녕하세요, 저는…",
          grade: "GOOD",
          // 채팅 면접은 다시보기 타임라인이 없다(웹 Swagger 6.4 items[].timeline)
          timeline: null,
        },
      ],
    } satisfies Omit<ReplayResponse, "items" | "mode"> & {
      items: Omit<ReplayResponse["items"][number], "answerCreatedAt">[];
    };
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT" })
      .uponReceiving("6.4 다시보기")
      .withRequest("GET", sessionPath("/replay"), (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape(replay, "recordingStartedAt", "videoStatus", "videoUrl", "persona"),
          items: eachLike(shape(replay.items[0], "grade", "timeline")),
        }),
      )
      .executeTest(
        asMember(async () => expect(await getReplay(55)).toMatchObject({ status: "ok" })),
      );
  });
  it("6.4 화상 면접 다시보기를 받는다(videoStatus READY)", () => {
    const reason = {
      metric: "FILLER",
      count: 3,
      text: "'음'이 이어졌어요. 생각할 때는 소리 없이 잠깐 멈춰도 괜찮아요.",
    } satisfies TimelineReason;
    const checkpoint = { at: 620.13, start: 619.13, end: 620.13, value: -2.1 };
    const replay = {
      id: 55,
      persona: "DEVIL",
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      startedAt: "2026-10-15T12:00:00+09:00",
      recordingStartedAt: "2026-10-15T12:00:03.120+09:00",
      videoStatus: "READY",
      videoUrl: "https://…s3…/recordings/55.mp4?X-Amz-Signature=…",
    } satisfies Omit<ReplayResponse, "items" | "mode">;
    const item = {
      questionId: 304,
      seq: 1,
      question: "백엔드 직무에 지원한 이유는?",
      questionCreatedAt: "2026-10-15T12:10:05+09:00",
      answer: "음… 서버 쪽이…",
      grade: "GOOD",
    } satisfies Omit<ReplayResponse["items"][number], "answerCreatedAt" | "timeline">;
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "VIDEO", recording: "READY" })
      .uponReceiving("6.4 화상 면접 다시보기")
      .withRequest("GET", sessionPath("/replay"), (b) => b.headers(bearer))
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape(replay, "videoStatus", "persona"),
          items: eachLike({
            ...shape(item, "grade"),
            timeline: {
              points: eachLike(shape({ at: 617.13, value: 0.4 })),
              checkpoints: eachLike({
                ...shape(checkpoint),
                reasons: eachLike({ ...shape(reason), metric: oneOf(METRICS, "FILLER") }),
              }),
            },
          }),
        }),
      )
      .executeTest(
        asMember(async () =>
          expect(await getReplay(55)).toMatchObject({
            status: "ok",
            data: { videoStatus: "READY", videoUrl: replay.videoUrl },
          }),
        ),
      );
  });
});

describe("성장 리뷰", () => {
  it("7.1 첫 면접 날의 성장 리뷰를 받는다", () => {
    const review = {
      practiceDate: "2026-10-15",
      isFirst: true,
      streakOnDate: 1,
      practiceDates: ["2026-10-15"],
      interviewCount: 1,
      practiceMinutes: 18,
      criteria: criteria.map((criterion) => ({
        criterion,
        grade: "NORMAL",
        delta: null,
        comment: "결론부터 말했어요",
      })),
      nextActions: ["꼬리 질문엔 근거부터 짧게"],
    } satisfies Omit<GrowthReviewResponse, "comparedDate" | "criteria"> & {
      criteria: Omit<GrowthReviewResponse["criteria"][number], "score">[];
    };
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT" })
      .uponReceiving("7.1 첫 면접 날 성장 리뷰")
      .withRequest(
        "GET",
        providerPath("/growth-reviews/${practiceDate}", "/growth-reviews/2026-10-15"),
        (b) => b.headers(bearer),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape(review, "isFirst", "interviewCount", "streakOnDate"),
          practiceDates: eachLike("2026-10-15"),
          criteria: review.criteria.map((row) => shape(row, "criterion", "grade", "delta")),
          nextActions: eachLike("꼬리 질문엔 근거부터 짧게"),
        }),
      )
      .executeTest(
        asMember(async () => expect((await getGrowthReview("2026-10-15"))?.isFirst).toBe(true)),
      );
  });

  // 어제(60점)에 이어 오늘(70점) 연습했다: 어제와 비교한 변화(delta)가 있다
  it("7.1 이틀째 연습한 날의 성장 리뷰를 받는다", () => {
    const review = {
      practiceDate: "2026-10-13",
      isFirst: false,
      streakOnDate: 2,
      practiceDates: ["2026-10-12", "2026-10-13"],
      interviewCount: 1,
      practiceMinutes: 18,
      criteria: criteria.map((criterion) => ({
        criterion,
        grade: "NORMAL",
        delta: 8,
        comment: "말 끊김이 줄었어요",
      })),
      nextActions: ["직무 적합성 질문 1개 더 연습하기"],
    } satisfies Omit<GrowthReviewResponse, "comparedDate" | "criteria"> & {
      criteria: Omit<GrowthReviewResponse["criteria"][number], "score">[];
    };
    return pact
      .addInteraction()
      .given("회원")
      .given("면접", { stage: "COMPLETED", mode: "CHAT", previousDay: true })
      .uponReceiving("7.1 이틀째 연습한 날 성장 리뷰")
      .withRequest(
        "GET",
        providerPath("/growth-reviews/${practiceDate}", "/growth-reviews/2026-10-13"),
        (b) => b.headers(bearer),
      )
      .willRespondWith(200, (b) =>
        b.jsonBody({
          ...shape(review, "isFirst", "interviewCount", "streakOnDate"),
          practiceDates: eachLike("2026-10-13"),
          // delta는 null이 아닌 수인지만 본다(FE는 부호로 나아진 점을 고른다)
          criteria: review.criteria.map((row) => shape(row, "criterion", "grade")),
          nextActions: eachLike("직무 적합성 질문 1개 더 연습하기"),
        }),
      )
      .executeTest(
        asMember(async () => expect((await getGrowthReview("2026-10-13"))?.isFirst).toBe(false)),
      );
  });

  it("7.1 연습하지 않은 날은 null(404 GROWTH_REVIEW_NOT_FOUND)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("7.1 연습하지 않은 날 성장 리뷰")
      .withRequest("GET", "/api/v1/growth-reviews/2026-01-01", (b) => b.headers(bearer))
      .willRespondWith(404, (b) => problem(b, { code: "GROWTH_REVIEW_NOT_FOUND" }))
      .executeTest(asMember(async () => expect(await getGrowthReview("2026-01-01")).toBeNull())));
});
