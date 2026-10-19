import { describe, expect, it } from "vitest";

import { pathAfterSignedOut, safeNextPath } from "./auth-errors";

describe("safeNextPath (재발급 뒤 돌아갈 주소)", () => {
  it("이 사이트 안의 경로 · 쿼리는 그대로", () => {
    expect(safeNextPath("/home")).toBe("/home");
    expect(safeNextPath("/records?page=2")).toBe("/records?page=2");
  });

  it("없거나 다른 사이트로 가는 주소면 홈", () => {
    expect(safeNextPath(null)).toBe("/home");
    expect(safeNextPath("")).toBe("/home");
    expect(safeNextPath("https://evil.example")).toBe("/home");
    expect(safeNextPath("//evil.example")).toBe("/home");
    expect(safeNextPath("/\\evil.example")).toBe("/home");
  });
});

describe("pathAfterSignedOut (UNAUTHORIZED로 쿠키를 지운 뒤 갈 곳)", () => {
  it("로그인 없이 보는 화면이면 그 화면에 머문다", () => {
    expect(pathAfterSignedOut("/")).toBe("/");
    expect(pathAfterSignedOut("/signup")).toBe("/signup");
  });

  it("로그인이 필요한 화면이면 S01 로그인", () => {
    expect(pathAfterSignedOut("/home")).toBe("/login");
    expect(pathAfterSignedOut("/records?page=2")).toBe("/login");
  });

  it("다른 사이트 주소는 받지 않는다", () => {
    expect(pathAfterSignedOut("//evil.example")).toBe("/login");
  });
});
