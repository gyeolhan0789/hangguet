import { describe, expect, it } from "vitest";

import { isDate } from "./date";

// 기준: 웹 Swagger(날짜는 YYYY-MM-DD, 한국 시간) — 주소로 받은 날짜(S08 · 연습 기록)를 검사한다.

describe("isDate (주소의 YYYY-MM-DD 검사)", () => {
  it.each(["2026-10-21", "2024-02-29", "2026-12-31"])("%s는 있는 날짜", (value) => {
    expect(isDate(value)).toBe(true);
  });

  // 주소 쿼리는 같은 키가 여러 번이면 배열로 온다. 제목에서 문자열과 구분되게 JSON으로 적는다.
  it.each(
    [
      "2026-13-01",
      "2026-02-30",
      "2025-02-29",
      "2026-1-5",
      "0000-01-01",
      "abc",
      "",
      undefined,
      ["2026-10-21"],
    ].map((value) => [JSON.stringify(value) ?? "undefined", value]),
  )("%s는 아니다", (_, value) => {
    expect(isDate(value)).toBe(false);
  });
});
