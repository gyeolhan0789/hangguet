// 기준: Figma S05-1 면접 방식 선택(18:2219) · 기획 메모 S05-1([다음] 문구: 화상 '다음: 장치 점검' · 채팅 '면접 시작')
// · Swagger 5.1 면접 만들기(Idempotency-Key: 같은 키 · 같은 본문이면 처음 결과를 그대로 반환)
// · Figma [초안] S05-1 함께 보기(488:2510: '친구와 함께 볼래요'를 켜면 [다음: 그룹 만들기] → G02)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSession, type SessionActionResult } from "@/lib/interview/actions";
import { deferred } from "@/test/deferred";
import { router } from "@/test/next-navigation";

import { ModeForm } from "./mode-form";

// 경계 mock: 서버 액션(5.1) · 화면 이동(next/navigation) · 연출(motion) · 멱등 키 난수(crypto.randomUUID, 순번으로 고정). 방식 카드(ModeCards)는 진짜로 그린다
vi.mock("@/lib/interview/actions", () => ({ createSession: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
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

// 예시 데이터: Swagger 4.2 지원서(12 · ○○전자 · 백엔드 개발자) · 5.1 persona DEVIL
// · 실패 문구는 Swagger 5.1 409 IDEMPOTENCY_KEY_REUSED 예시 detail(대체 문구 RETRY_LATER와 다르다)
const SERVER_DETAIL = "이미 처리된 요청이에요.";
const FAILED: SessionActionResult = { formError: SERVER_DETAIL };

function renderForm() {
  return render(
    <ModeForm applicationId={12} persona="DEVIL" subtitle="악마 면접관 · ○○전자 백엔드 개발자" />,
  );
}

const choose = (name: RegExp) => fireEvent.click(screen.getByRole("radio", { name }));
const nextButton = () => screen.getByRole("button", { name: /다음: 장치 점검|면접 시작/ });

/** [다음]을 누르고, 테스트가 응답을 정하는 5.1 요청 하나를 돌려준다 */
function submitWith() {
  const response = deferred<SessionActionResult>();
  vi.mocked(createSession).mockReturnValueOnce(response.promise);
  fireEvent.click(nextButton());
  return response;
}

describe("ModeForm · S05-1 면접 방식 선택", () => {
  describe("화면 표시", () => {
    it("방식을 고르기 전에는 [다음: 장치 점검]을 누를 수 없다", () => {
      renderForm();

      expect(screen.getByRole("button", { name: "다음: 장치 점검" }).hasAttribute("disabled")).toBe(
        true,
      );
    });

    it("채팅을 고르면 [다음] 문구가 '면접 시작'으로 바뀐다", () => {
      renderForm();

      choose(/채팅으로 할래요/);

      expect(screen.getByRole("button", { name: "면접 시작" })).toBeDefined();
    });
  });

  describe("함께 보기", () => {
    describe("화면 표시", () => {
      it("'친구와 함께 볼래요'를 켜면 [다음] 문구가 '다음: 그룹 만들기'로 바뀐다", () => {
        renderForm();
        choose(/채팅으로 할래요/);

        fireEvent.click(screen.getByRole("switch", { name: "친구와 함께 볼래요" }));

        expect(screen.getByRole("button", { name: "다음: 그룹 만들기" })).toBeDefined();
      });
    });

    describe("사용자 조작", () => {
      it("켜고 [다음]을 누르면 면접을 만들지 않고 고른 지원서 · 면접관 · 방식으로 그룹 만들기로 간다", () => {
        renderForm();
        choose(/채팅으로 할래요/);
        fireEvent.click(screen.getByRole("switch", { name: "친구와 함께 볼래요" }));

        fireEvent.click(screen.getByRole("button", { name: "다음: 그룹 만들기" }));

        expect(router.push).toHaveBeenCalledWith(
          "/groups/new?applicationId=12&persona=DEVIL&mode=CHAT",
        );
        expect(createSession).not.toHaveBeenCalled();
      });
    });
  });

  describe("사용자 조작", () => {
    it("방식을 고르고 [다음]을 누르면 지원서 · 면접관 · 고른 방식으로 면접 만들기를 요청한다", async () => {
      renderForm();
      choose(/화상으로 할래요/);

      const response = submitWith();

      expect(createSession).toHaveBeenCalledWith(
        { applicationId: 12, persona: "DEVIL", mode: "VIDEO" },
        "key-1",
      );
      await act(async () => response.resolve({}));
    });
  });

  describe("상태 변화", () => {
    it("서버가 실패로 답하지 않았으면 같은 방식으로 다시 보낼 때 같은 멱등 키를 쓴다", async () => {
      renderForm();
      choose(/화상으로 할래요/);
      const first = submitWith();
      await act(async () => first.resolve(FAILED));

      const second = submitWith();

      expect(vi.mocked(createSession).mock.calls.map(([, key]) => key)).toEqual(["key-1", "key-1"]);
      await act(async () => second.resolve({}));
    });

    it("서버가 실패로 답했으면(keySpent) 다음에는 새 멱등 키로 보낸다", async () => {
      renderForm();
      choose(/화상으로 할래요/);
      const first = submitWith();
      await act(async () => first.resolve({ ...FAILED, keySpent: true }));

      const second = submitWith();

      expect(vi.mocked(createSession).mock.calls.map(([, key]) => key)).toEqual(["key-1", "key-3"]);
      await act(async () => second.resolve({}));
    });

    it("방식을 바꾸면 다른 멱등 키로 보낸다", async () => {
      renderForm();
      choose(/화상으로 할래요/);
      const first = submitWith();
      await act(async () => first.resolve(FAILED));
      choose(/채팅으로 할래요/);

      const second = submitWith();

      expect(
        vi.mocked(createSession).mock.calls.map(([values, key]) => [values.mode, key]),
      ).toEqual([
        ["VIDEO", "key-1"],
        ["CHAT", "key-2"],
      ]);
      await act(async () => second.resolve({}));
    });

    it("다시 보내면 지난 실패 문구를 지운다", async () => {
      renderForm();
      choose(/화상으로 할래요/);
      const first = submitWith();
      await act(async () => first.resolve(FAILED));
      expect(screen.getByRole("alert").textContent).toBe(SERVER_DETAIL);

      const second = submitWith();

      expect(screen.queryByRole("alert")).toBeNull();
      await act(async () => second.resolve({}));
    });
  });

  describe("오류 처리", () => {
    it("면접을 만들지 못하면 그 문구를 보여 준다", async () => {
      renderForm();
      choose(/화상으로 할래요/);
      const response = submitWith();

      await act(async () => response.resolve(FAILED));

      expect(screen.getByRole("alert").textContent).toBe(SERVER_DETAIL);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("응답을 기다리는 동안 [다음]을 누를 수 없어 두 번 눌러도 한 번만 요청한다", async () => {
      renderForm();
      choose(/화상으로 할래요/);
      const response = submitWith();

      fireEvent.click(nextButton());

      expect(nextButton().hasAttribute("disabled")).toBe(true);
      expect(createSession).toHaveBeenCalledTimes(1);
      await act(async () => response.resolve({}));
    });
  });
});
