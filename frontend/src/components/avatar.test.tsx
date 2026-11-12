// 기준: Figma C/App Header Avatar(17:49) · C01 드롭다운 · S09 · S09-1 Avatar(18:3187) — 회색 원 안 사람 아이콘, 사진(2.1 profileImageUrl)이 있으면 위에 덮는다
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Avatar } from "./avatar";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("Avatar · 프로필 사진", () => {
  describe("화면 표시", () => {
    it("사진이 없으면 사진 층을 그리지 않는다", () => {
      render(
        <Avatar imageUrl={null} size={56} icon="/mypage/icon-user-round-md.svg" iconSize={28} />,
      );

      expect(screen.queryByTestId("avatar-image")).toBeNull();
    });
  });
});
