// 기준: Figma [초안] G03 초대 확인 · 참가(484:2552) · BE Swagger 10.2 초대 확인 · 10.3 그룹 참가(Idempotency-Key)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { joinGroup } from "@/lib/group/actions";
import type { ApplicationListItem, InviteResponse } from "@/types/api";

import { InviteJoinForm } from "./invite-join-form";

// 경계 mock: 서버 액션(10.3) · 연출 · 멱등 키 난수
vi.mock("@/lib/group/actions", () => ({ joinGroup: vi.fn(async () => ({})) }));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue("key-1" as ReturnType<typeof crypto.randomUUID>);
});

// 예시 데이터: BE Swagger 10.2 초대 확인 예시 · 4.3 지원서 목록
const INVITE: InviteResponse = {
  groupId: 7,
  hostNickname: "면접왕",
  mode: "VIDEO",
  persona: "COFFEE_CHAT",
  jobCategory: "DEVELOPMENT",
  capacity: 3,
  participantCount: 2,
};
const APPLICATIONS = [
  {
    id: 15,
    companyName: "가온페이",
    jobTitle: "데이터 엔지니어",
    createdAt: "2026-10-02T10:00:00+09:00",
  },
] satisfies ApplicationListItem[];

function renderForm(applications: ApplicationListItem[] = APPLICATIONS) {
  return render(<InviteJoinForm inviteCode="K7Q2ZP" invite={INVITE} applications={applications} />);
}
const MISMATCH = /그룹 직군\(개발\)과 달라요/;

describe("InviteJoinForm · G03 초대 확인 · 참가", () => {
  describe("그룹 참가", () => {
    describe("화면 표시", () => {
      it("처음에는 그룹 직군을 골라 둬 직군이 다르다는 안내가 없다", () => {
        renderForm();

        expect(screen.queryByText(MISMATCH)).toBeNull();
      });

      it("지원서가 없으면 [참가하기]를 누를 수 없다", () => {
        renderForm([]);

        expect(screen.getByRole("button", { name: "참가하기" }).hasAttribute("disabled")).toBe(
          true,
        );
      });
    });

    describe("상태 변화", () => {
      it("그룹과 다른 직군을 고르면 달라도 참가할 수 있다는 안내를 보인다", () => {
        renderForm();

        fireEvent.click(screen.getByRole("radio", { name: "데이터·AI" }));

        expect(screen.getByText(MISMATCH)).toBeDefined();
      });
    });

    describe("사용자 조작", () => {
      it("[참가하기]를 누르면 초대 코드 · 고른 지원서 · 직군으로 참가를 요청한다", async () => {
        renderForm();
        fireEvent.click(screen.getByRole("radio", { name: "데이터·AI" }));

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "참가하기" })));

        expect(joinGroup).toHaveBeenCalledWith(
          { inviteCode: "K7Q2ZP", applicationId: 15, jobCategory: "DATA_AI" },
          "key-1",
        );
      });
    });

    describe("오류 처리", () => {
      it("참가하지 못하면 그 문구를 보여 준다", async () => {
        vi.mocked(joinGroup).mockResolvedValueOnce({ formError: "자리가 다 찼어요." });
        renderForm();

        await act(async () => fireEvent.click(screen.getByRole("button", { name: "참가하기" })));

        expect(screen.getByRole("alert").textContent).toBe("자리가 다 찼어요.");
      });
    });
  });
});
