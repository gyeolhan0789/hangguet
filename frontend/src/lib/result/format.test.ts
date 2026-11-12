// @vitest-environment node
// 기준: 기획 메모 S07(질문별 피드백은 첫 번째 WEAK · NORMAL 질문만 펼친다) · ResultResponse.startedAt · endedAt
// · ReplayItem.questionCreatedAt(녹화 시작과의 차이가 영상 속 질문 위치) · 자막은 questionCreatedAt ≤ 위치 < 다음 질문
import { describe, expect, it } from "vitest";

import { REPLAY, RESULT } from "@/test/result-examples";

import {
  durationMinutes,
  firstOpenQuestion,
  itemIndexAt,
  monthDayKst,
  questionOffset,
} from "./format";

describe("durationMinutes · 면접 시간(분)", () => {
  describe("정상 처리", () => {
    it("시작과 끝의 차이를 분 단위로 내린다", () => {
      expect(durationMinutes("2026-10-15T12:00:00+09:00", "2026-10-15T12:18:59+09:00")).toBe(18);
    });
  });
});

describe("monthDayKst · 한국 날짜 표시", () => {
  describe("정상 처리", () => {
    it("UTC 시각을 한국 날짜 'M월 D일'로 바꾼다", () => {
      expect(monthDayKst("2026-10-14T15:30:00Z")).toBe("10월 15일");
    });
  });
});

describe("firstOpenQuestion · 처음 펼칠 질문", () => {
  describe("정상 처리", () => {
    it("첫 번째 '보통' · '아쉬워요' 질문의 id를 돌려준다", () => {
      // 예시: Q1 · Q2 좋아요, Q3 보통, Q4 아쉬워요
      expect(firstOpenQuestion(RESULT.answers)).toBe(303);
    });
  });

  describe("경계값", () => {
    it("모두 '좋아요'면 null을 돌려준다", () => {
      const allGood = RESULT.answers.map((answer) => ({ ...answer, grade: "GOOD" as const }));

      expect(firstOpenQuestion(allGood)).toBeNull();
    });
  });
});

describe("questionOffset · 영상 속 질문 위치", () => {
  describe("정상 처리", () => {
    it("녹화 시작과 질문 시각의 차이를 초로 돌려준다", () => {
      // 예시 마커 00:38(녹화 12:00:03.120 → 질문 12:00:42)
      expect(questionOffset(REPLAY.recordingStartedAt, REPLAY.items[0])).toBe(38.88);
    });
  });

  describe("경계값", () => {
    it("질문 시각이 녹화 시작보다 앞서면(1~2초 오차) 0초로 둔다", () => {
      const early = { ...REPLAY.items[0], questionCreatedAt: "2026-10-15T12:00:01+09:00" };

      expect(questionOffset(REPLAY.recordingStartedAt, early)).toBe(0);
    });
  });
});

describe("itemIndexAt · 재생 위치가 속한 질문", () => {
  const offsets = [42, 190, 372];

  describe("정상 처리", () => {
    it("위치가 두 질문 사이면 앞 질문의 순번을 돌려준다", () => {
      expect(itemIndexAt(offsets, 200)).toBe(1);
    });
  });

  describe("경계값", () => {
    it("첫 질문 전이면 -1을 돌려준다", () => {
      expect(itemIndexAt(offsets, 41.9)).toBe(-1);
    });

    it("위치가 질문 시각과 같으면 그 질문의 순번을 돌려준다", () => {
      expect(itemIndexAt(offsets, 190)).toBe(1);
    });
  });
});
