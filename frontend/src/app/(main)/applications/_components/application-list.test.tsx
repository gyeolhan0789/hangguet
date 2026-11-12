// 기준: Figma 지원 관리 · 목록 · Swagger 4.3 ApplicationListItem(companyName · jobTitle · createdAt)
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApplicationList } from "./application-list";

// 경계 mock: 연출(motion)은 건너뛴다
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

describe("ApplicationList · 지원 관리 목록", () => {
  describe("화면 표시", () => {
    it("지원서가 없으면 목록을 그리지 않는다", () => {
      render(<ApplicationList items={[]} page={0} />);

      expect(screen.queryByRole("list")).toBeNull();
    });
  });
});
