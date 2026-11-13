// 기준: Figma [초안] G02 그룹 만들기(484:2318) · BE Swagger 10.1 그룹 만들기(Idempotency-Key)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createGroup } from "@/lib/group/actions";
import type { ApplicationListItem } from "@/types/api";

import { GroupCreateForm } from "./group-create-form";

// 경계 mock: 서버 액션(10.1) · 연출 · 멱등 키 난수(순번으로 고정)
vi.mock("@/lib/group/actions", () => ({ createGroup: vi.fn(async () => ({})) }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

let keys = 0;
beforeEach(() => {
  keys = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `key-${++keys}` as ReturnType<typeof crypto.randomUUID>,
  );
});

// 예시 데이터: Swagger 4.3 지원서 목록(12 가온페이 · 15 ○○전자)
const APPLICATIONS = [
  {
    id: 12,
    companyName: "가온페이",
    jobTitle: "백엔드 개발자",
    createdAt: "2026-10-01T10:00:00+09:00",
  },
  {
    id: 15,
    companyName: "○○전자",
    jobTitle: "데이터 엔지니어",
    createdAt: "2026-10-02T10:00:00+09:00",
  },
] satisfies ApplicationListItem[];

function renderForm() {
  return render(
    <GroupCreateForm
      applications={APPLICATIONS}
      initial={{ applicationId: 12, persona: "DEVIL", mode: "CHAT" }}
    />,
  );
}
const createButton = () => screen.getByRole("button", { name: "그룹 만들기" });

describe("GroupCreateForm · G02 그룹 만들기", () => {
  describe("그룹 만들기", () => {
    describe("화면 표시", () => {
      it("면접관 · 방식은 다시 묻지 않고 인원은 3명을 골라 둔 채 연다", () => {
        renderForm();

        expect(screen.queryByRole("radio", { name: "악마 면접관" })).toBeNull();
        expect(screen.queryByRole("radio", { name: "채팅" })).toBeNull();
        expect((screen.getByRole("radio", { name: "3명" }) as HTMLInputElement).checked).toBe(true);
      });

      it("그룹 직군은 '개발'을 골라 둔 채 연다", () => {
        renderForm();

        expect((screen.getByRole("radio", { name: "개발" }) as HTMLInputElement).checked).toBe(
          true,
        );
      });
    });

    describe("사용자 조작", () => {
      it("인원 · 직군을 바꾸고 [그룹 만들기]를 누르면 고른 값으로 그룹 만들기를 요청한다", async () => {
        renderForm();
        fireEvent.click(screen.getByRole("radio", { name: "기획" }));
        fireEvent.click(screen.getByRole("radio", { name: "2명" }));

        await act(async () => fireEvent.click(createButton()));

        expect(createGroup).toHaveBeenCalledWith(
          {
            applicationId: 12,
            persona: "DEVIL",
            mode: "CHAT",
            capacity: 2,
            jobCategory: "PLANNING",
          },
          "key-1",
        );
      });
    });

    describe("오류 처리", () => {
      it("서버가 실패로 답했으면(keySpent) 다음에는 새 멱등 키로 보낸다", async () => {
        vi.mocked(createGroup).mockResolvedValueOnce({
          formError: "이미 다른 그룹에 있어요.",
          keySpent: true,
        });
        renderForm();
        await act(async () => fireEvent.click(createButton()));

        await act(async () => fireEvent.click(createButton()));

        expect(vi.mocked(createGroup).mock.calls.map(([, key]) => key)).toEqual(["key-1", "key-2"]);
      });
    });
  });
});
