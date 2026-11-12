// @vitest-environment node
// 기준: Swagger 날짜 문자열(한국 시간 YYYY-MM-DD) · 5.15 month 연도 0001~9999 · Figma S02 자정까지 남은 시간
import { describe, expect, it, vi } from "vitest";

import { addDays, isDate, shortDate, todayKst, untilMidnightKst, weekdayOf } from "./date";

/** 지금 시각을 고정한다(시각 기본값 new Date()를 쓰는 함수) */
function nowIs(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

/** 실행 환경 시간대를 KST가 아닌 UTC로 바꾼다(설정의 Asia/Seoul 고정은 테스트마다 되돌아간다) */
function runInUtc() {
  vi.stubEnv("TZ", "UTC");
}

describe("todayKst · 한국 시간 오늘", () => {
  describe("정상 처리", () => {
    it("시각을 넘기지 않으면 지금 시각의 한국 날짜를 'YYYY-MM-DD'로 돌려준다", () => {
      nowIs("2026-11-12T03:00:00Z");

      expect(todayKst()).toBe("2026-11-12");
    });
  });

  describe("경계값", () => {
    it.each([
      { utc: "2026-10-14T14:59:59Z", date: "2026-10-14" },
      { utc: "2026-10-14T15:00:00Z", date: "2026-10-15" },
      { utc: "2026-10-14T15:30:00Z", date: "2026-10-15" },
    ])("실행 환경이 UTC여도 지금이 '$utc'면 한국 날짜 '$date'를 돌려준다", ({ utc, date }) => {
      runInUtc();
      nowIs(utc);

      expect(todayKst()).toBe(date);
    });
  });
});

describe("addDays · 날짜 더하기", () => {
  describe("정상 처리", () => {
    it("날짜에 1일을 더한다", () => {
      expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    });
  });
});

describe("weekdayOf · 요일", () => {
  describe("정상 처리", () => {
    it.each([
      { date: "2026-11-15", weekday: "일" },
      { date: "2026-10-15", weekday: "목" },
      { date: "2026-11-14", weekday: "토" },
    ])("'$date'의 요일은 '$weekday'다", ({ date, weekday }) => {
      expect(weekdayOf(date)).toBe(weekday);
    });
  });
});

describe("shortDate · 짧은 날짜", () => {
  describe("정상 처리", () => {
    it.each([
      { date: "2026-10-12", expected: "10.12" },
      { date: "2026-01-05", expected: "01.05" },
    ])("'$date'를 앞 0을 살린 '$expected'로 바꾼다", ({ date, expected }) => {
      expect(shortDate(date)).toBe(expected);
    });
  });
});

describe("untilMidnightKst · 자정까지 남은 시간", () => {
  describe("정상 처리", () => {
    it("시각을 넘기지 않으면 지금부터 한국 시간 자정까지 남은 시간을 'HH:MM:SS'로 돌려준다", () => {
      nowIs("2026-10-15T12:29:45Z");

      expect(untilMidnightKst()).toBe("02:30:15");
    });
  });

  describe("경계값", () => {
    it.each([
      { utc: "2026-10-15T14:00:00Z", left: "01:00:00" },
      { utc: "2026-10-15T14:59:59Z", left: "00:00:01" },
      { utc: "2026-10-15T15:00:01Z", left: "23:59:59" },
    ])(
      "실행 환경이 UTC여도 지금이 '$utc'면 한국 자정까지 '$left'가 남았다고 돌려준다",
      ({ utc, left }) => {
        runInUtc();
        nowIs(utc);

        expect(untilMidnightKst()).toBe(left);
      },
    );

    it("한국 시간 정각 자정이면 '24:00:00'을 돌려준다", () => {
      expect(untilMidnightKst(new Date("2026-10-15T15:00:00Z"))).toBe("24:00:00");
    });

    it("1초 안의 남은 밀리초는 버린다", () => {
      expect(untilMidnightKst(new Date("2026-10-15T14:59:58.500Z"))).toBe("00:00:01");
    });
  });
});

describe("isDate · 주소 날짜 검사", () => {
  describe("정상 처리", () => {
    it("있는 날짜는 통과한다", () => {
      expect(isDate("2026-10-21")).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "없는 달 13월", value: "2026-13-01" },
      { label: "없는 달 0월", value: "2026-00-10" },
      { label: "형식 다름 2026-1-1", value: "2026-1-1" },
      { label: "형식 다름 20261021", value: "20261021" },
      { label: "형식 다름 시각 붙음", value: "2026-10-21T00:00" },
      { label: "빈 문자열", value: "" },
      { label: "undefined", value: undefined },
      { label: "배열(주소 값이 여러 개)", value: ["2026-10-21", "2026-10-22"] },
    ])("'$label'이면 통과하지 않는다", ({ value }) => {
      expect(isDate(value)).toBe(false);
    });
  });

  describe("경계값", () => {
    it.each([
      { value: "2024-02-29", ok: true },
      { value: "2026-02-29", ok: false },
      { value: "0000-01-01", ok: false },
    ])("날짜가 '$value'이면 통과 여부는 '$ok'다", ({ value, ok }) => {
      expect(isDate(value)).toBe(ok);
    });
  });
});
