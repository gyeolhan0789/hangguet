// 기준: Figma 지원서 쓰기 · 기획 메모 지원서 쓰기(첫 화면은 문항 1개, 문항이 1개면 ✕ 숨김, 400이면 자기소개서 아래 서버 문구)
// · 모션 메모 지원서 쓰기([+ 문항 추가] 뒤 문항 칸에 포커스) · Swagger 4.1 지원서 작성(400 VALIDATION_FAILED · 503) · 4.7 회사 목록
// · 사용자 결정(2026-10-29: 빈 문항 · 답변이 있으면 [저장하기] 비활성, 저장 뒤 · [← 뒤로]는 들어온 곳으로)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createApplication, type ApplicationActionResult } from "@/lib/application/actions";
import type { CompanyItem } from "@/types/api";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";

import { ApplicationWriteForm } from "./application-write-form";

// 경계 mock: 서버 액션(4.1) · Next 라우터(bfcacheId) · 연출(motion)
vi.mock("@/lib/application/actions", () => ({ createApplication: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

// 예시 데이터: Swagger 4.1 400 COVER_LETTER_UNUSABLE · 503 COVER_LETTER_CHECK_UNAVAILABLE 문구, 4.7 200 예시의 첫 회사
const COVER_LETTER_UNUSABLE =
  "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.";
const CHECK_UNAVAILABLE = "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
const COMPANIES: CompanyItem[] = [{ id: 2, name: "NAVER", aliases: ["naver", "네이버"] }];

const save = () => screen.getByRole("button", { name: "저장하기" });
const addButton = () => screen.getByRole("button", { name: "+ 문항 추가" });
const addQuestion = () => fireEvent.click(addButton());
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const valueOf = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;

/** 모든 칸을 채우고 검사(zodResolver, 비동기)가 끝나기를 기다린다 */
async function fillAll() {
  type("회사명", "○○전자");
  type("직무", "백엔드 개발자");
  type("문항 1", "지원 동기");
  type("문항 1 답변", "저는…");
  await flushPromises();
}

/** [저장하기]를 누르고 검사 · 서버 액션 결과 반영을 기다린다 */
async function submit() {
  fireEvent.click(save());
  await flushPromises();
}

describe("ApplicationWriteForm · 지원서 쓰기", () => {
  describe("문항", () => {
    describe("화면 표시", () => {
      it("처음에는 문항 1개를 빼기 버튼 없이 보여 준다", () => {
        render(<ApplicationWriteForm from="applications" />);

        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        expect(screen.queryByRole("button", { name: /빼기$/ })).toBeNull();
      });

      it("문항이 2개 이상이면 문항마다 빼기 버튼을 보여 준다", () => {
        render(<ApplicationWriteForm from="applications" />);

        addQuestion();

        expect(screen.getByRole("button", { name: "문항 1 빼기" })).toBeDefined();
        expect(screen.getByRole("button", { name: "문항 2 빼기" })).toBeDefined();
      });

      it("답변 글자 수는 문항마다 그 답변의 길이를 센다", () => {
        render(<ApplicationWriteForm from="applications" />);
        addQuestion();

        type("문항 2 답변", "가나다");

        expect(
          screen.getByRole("textbox", { name: "문항 1 답변", description: "글자 수 0 / 20,000" }),
        ).toBeDefined();
        expect(
          screen.getByRole("textbox", { name: "문항 2 답변", description: "글자 수 3 / 20,000" }),
        ).toBeDefined();
      });
    });

    describe("사용자 조작", () => {
      it("[+ 문항 추가]를 누르면 문항이 하나 늘고 새 문항 칸에 포커스가 간다", () => {
        render(<ApplicationWriteForm from="applications" />);

        addQuestion();

        expect(screen.getAllByRole("listitem")).toHaveLength(2);
        expect(document.activeElement).toBe(screen.getByLabelText("문항 2"));
      });

      it("문항을 빼면 포커스가 [+ 문항 추가]로 간다", () => {
        render(<ApplicationWriteForm from="applications" />);
        addQuestion();

        fireEvent.click(screen.getByRole("button", { name: "문항 1 빼기" }));

        expect(document.activeElement).toBe(addButton());
      });
    });

    describe("경계값", () => {
      it("문항이 5개면 [+ 문항 추가]를 숨긴다", () => {
        render(<ApplicationWriteForm from="applications" />);

        Array.from({ length: 4 }).forEach(addQuestion);

        expect(screen.getAllByRole("listitem")).toHaveLength(5);
        expect(screen.queryByRole("button", { name: "+ 문항 추가" })).toBeNull();
      });

      it("5개에서 하나를 빼면 [+ 문항 추가]가 다시 그려지며 포커스를 받는다", () => {
        render(<ApplicationWriteForm from="applications" />);
        Array.from({ length: 4 }).forEach(addQuestion);

        fireEvent.click(screen.getByRole("button", { name: "문항 5 빼기" }));

        expect(document.activeElement).toBe(addButton());
      });
    });
  });

  describe("회사명", () => {
    describe("사용자 조작", () => {
      it("회사 목록에서 고른 회사명으로 저장을 요청한다", async () => {
        vi.mocked(createApplication).mockResolvedValue({});
        render(<ApplicationWriteForm from="applications" companies={COMPANIES} />);
        type("회사명", "네이버");
        fireEvent.click(screen.getByRole("option", { name: /^NAVER/ }));
        type("직무", "백엔드 개발자");
        type("문항 1", "지원 동기");
        type("문항 1 답변", "저는…");
        await flushPromises();

        await submit();

        expect(vi.mocked(createApplication).mock.calls[0][0].companyName).toBe("NAVER");
      });
    });
  });

  describe("저장", () => {
    describe("화면 표시", () => {
      it("모든 칸을 채우면 [저장하기]를 누를 수 있다", async () => {
        render(<ApplicationWriteForm from="applications" />);

        await fillAll();

        expect(save().hasAttribute("disabled")).toBe(false);
      });
    });

    describe("사용자 조작", () => {
      it("[저장하기]를 누르면 적은 값을 문항 순서대로 담아 들어온 곳과 함께 저장을 요청한다", async () => {
        vi.mocked(createApplication).mockResolvedValue({});
        render(<ApplicationWriteForm from="practice" />);
        await fillAll();
        addQuestion();
        type("문항 2", "협업 경험");
        type("문항 2 답변", "함께했습니다.");
        await flushPromises();

        await submit();

        expect(createApplication).toHaveBeenCalledWith(
          {
            companyName: "○○전자",
            jobTitle: "백엔드 개발자",
            coverLetterItems: [
              { question: "지원 동기", answer: "저는…" },
              { question: "협업 경험", answer: "함께했습니다." },
            ],
          },
          "practice",
        );
      });

      it("가운데 문항을 뺀 뒤 저장하면 뺀 문항 없이 남은 문항만 순서대로 보낸다", async () => {
        vi.mocked(createApplication).mockResolvedValue({});
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();
        addQuestion();
        addQuestion();
        type("문항 2", "협업 경험");
        type("문항 2 답변", "함께했습니다.");
        type("문항 3", "입사 후 포부");
        type("문항 3 답변", "성장하겠습니다.");

        fireEvent.click(screen.getByRole("button", { name: "문항 2 빼기" }));
        await flushPromises();
        await submit();

        expect(vi.mocked(createApplication).mock.calls[0][0].coverLetterItems).toEqual([
          { question: "지원 동기", answer: "저는…" },
          { question: "입사 후 포부", answer: "성장하겠습니다." },
        ]);
      });
    });

    describe("상태 변화", () => {
      it("자기소개서 거절 문구가 있어도 같은 내용으로 다시 저장할 수 있다", async () => {
        vi.mocked(createApplication).mockResolvedValue({
          fieldErrors: { coverLetterItems: COVER_LETTER_UNUSABLE },
        });
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();

        await submit();

        expect(screen.getByRole("alert").textContent).toBe(COVER_LETTER_UNUSABLE);
        expect(save().hasAttribute("disabled")).toBe(false);
      });

      it("다시 저장하면 지난 자기소개서 거절 문구를 지운다", async () => {
        const second = deferred<ApplicationActionResult>();
        vi.mocked(createApplication)
          .mockResolvedValueOnce({ fieldErrors: { coverLetterItems: COVER_LETTER_UNUSABLE } })
          .mockReturnValueOnce(second.promise);
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();
        await submit();
        expect(screen.getByRole("alert")).toBeDefined();

        await submit();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({}));
      });

      it("다시 저장하면 지난 폼 오류 문구를 지운다", async () => {
        const second = deferred<ApplicationActionResult>();
        vi.mocked(createApplication)
          .mockResolvedValueOnce({ formError: CHECK_UNAVAILABLE })
          .mockReturnValueOnce(second.promise);
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();
        await submit();
        expect(screen.getByRole("alert")).toBeDefined();

        await submit();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({}));
      });
    });

    describe("입력 검증", () => {
      it("빈 문항을 추가해 두면 [저장하기]를 누를 수 없다", async () => {
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();

        addQuestion();
        await flushPromises();

        expect(save().hasAttribute("disabled")).toBe(true);
      });

      it("회사명을 비우면 칸 아래 문구 없이 [저장하기]만 끈다", async () => {
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();

        type("회사명", "");
        await flushPromises();

        expect(save().hasAttribute("disabled")).toBe(true);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(
          screen.getByRole("textbox", { name: "회사명" }).getAttribute("aria-invalid"),
        ).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("서버가 자기소개서를 거절하면 자기소개서 아래에 그 문구를 보여 준다", async () => {
        vi.mocked(createApplication).mockResolvedValue({
          fieldErrors: { coverLetterItems: COVER_LETTER_UNUSABLE },
        });
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();

        await submit();

        expect(
          screen.getByRole("group", { name: "자기소개서", description: COVER_LETTER_UNUSABLE }),
        ).toBeDefined();
      });

      it("서버가 회사명을 거절하면 회사명 칸 아래에 문구를 보여 주고 칸을 오류로 표시한다", async () => {
        vi.mocked(createApplication).mockResolvedValue({
          fieldErrors: { companyName: "1~100자입니다." },
        });
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();

        await submit();

        const company = screen.getByRole("textbox", {
          name: "회사명",
          description: "1~100자입니다.",
        });
        expect(company.getAttribute("aria-invalid")).toBe("true");
      });

      it("서버가 직무를 거절하면 직무 칸 아래에 문구를 보여 주고 칸을 오류로 표시한다", async () => {
        vi.mocked(createApplication).mockResolvedValue({
          fieldErrors: { jobTitle: "1~100자입니다." },
        });
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();

        await submit();

        const job = screen.getByRole("textbox", { name: "직무", description: "1~100자입니다." });
        expect(job.getAttribute("aria-invalid")).toBe("true");
      });

      it("폼 오류를 받으면 폼 아래에 그 문구를 보여 준다", async () => {
        vi.mocked(createApplication).mockResolvedValue({ formError: CHECK_UNAVAILABLE });
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();

        await submit();

        expect(screen.getByRole("alert").textContent).toBe(CHECK_UNAVAILABLE);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("저장 응답을 기다리는 동안 [저장하기]를 누를 수 없어 두 번 눌러도 한 번만 요청한다", async () => {
        const response = deferred<ApplicationActionResult>();
        vi.mocked(createApplication).mockReturnValue(response.promise);
        render(<ApplicationWriteForm from="applications" />);
        await fillAll();
        await submit();

        await submit();

        expect(save().hasAttribute("disabled")).toBe(true);
        expect(createApplication).toHaveBeenCalledTimes(1);
        await act(async () => response.resolve({}));
      });
    });
  });

  describe("새로 들어오기", () => {
    describe("상태 변화", () => {
      it("같은 주소로 새로 들어오면(bfcacheId가 바뀜) 문항 1개 · 빈 칸 · 문구 없이 처음부터 그린다", async () => {
        vi.mocked(createApplication).mockResolvedValue({ formError: CHECK_UNAVAILABLE });
        const { rerender } = render(<ApplicationWriteForm from="applications" />);
        await fillAll();
        addQuestion();
        type("문항 2", "협업 경험");
        type("문항 2 답변", "함께했습니다.");
        await flushPromises();
        await submit();
        expect(screen.getByRole("alert")).toBeDefined();

        router.bfcacheId = "entry-2";
        rerender(<ApplicationWriteForm from="applications" />);

        expect(screen.getAllByRole("listitem")).toHaveLength(1);
        expect(valueOf("회사명")).toBe("");
        expect(valueOf("직무")).toBe("");
        expect(valueOf("문항 1")).toBe("");
        expect(valueOf("문항 1 답변")).toBe("");
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });

  describe("이동", () => {
    describe("화면 표시", () => {
      it.each([
        { from: "practice", href: "/practice" },
        { from: "applications", href: "/applications" },
      ] as const)("[← 뒤로]는 들어온 곳('$from')으로 간다", ({ from, href }) => {
        render(<ApplicationWriteForm from={from} />);

        expect(screen.getByRole("link", { name: "뒤로" }).getAttribute("href")).toBe(href);
      });
    });
  });
});
