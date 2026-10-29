import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationWriteForm } from "./application-write-form";

// 기준: Figma 지원서 쓰기 · 기획 메모 지원서 쓰기(첫 화면은 문항 1개, 문항이 1개면 ✕ 숨김, 400이면 자기소개서 아래 서버 문구)
// · 모션 메모 지원서 쓰기([+ 문항 추가] 뒤 문항 칸에 포커스) · Swagger 4.1(coverLetterItems 1~5개 · 문항 255자 · 답변 20,000자,
//   400 VALIDATION_FAILED coverLetterItems · 503) · ERD cover_letter_items(지원서당 최대 5개)
// · 사용자 결정(2026-10-29: 문항 · 답변이 하나라도 비면 [저장하기] 비활성, 저장 뒤 · [← 뒤로]는 들어온 곳으로)
// · 문항이 5개면 [+ 문항 추가]를 숨긴다(문항이 1개면 ✕를 숨기는 것과 같은 방식)
// 서버 액션 경계만 바꾼다. 실제 4.1 요청과 이동은 E2E(applications.spec.ts)가 본다.

const createApplication = vi.hoisted(() => vi.fn());
vi.mock("@/lib/application/actions", () => ({
  createApplication: (...args: unknown[]) => createApplication(...args),
}));

// 새로 들어올 때마다 폼을 새로 그리는 키(bfcacheId)만 쓴다. push · replace는 테스트가 값을 바꿔 흉내 낸다.
const router = vi.hoisted(() => ({ bfcacheId: "entry-1" }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// 문항 상자 · 오류 문구가 나타나고 사라지는 연출을 건너뛰어 실제 시간(다음 프레임)을 기다리지 않는다.
// 퇴장 연출(AnimatePresence)은 바로 지우도록 바꾸고, 연출 자체는 브라우저 확인이 맡는다.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  AnimatePresence: ({ children }: { children?: ReactNode }) => children,
}));
beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});
beforeEach(() => {
  createApplication.mockReset();
  router.bfcacheId = "entry-1";
});
afterEach(() => {
  cleanup();
});

const save = () => screen.getByRole("button", { name: "저장하기" });
const addQuestion = () => fireEvent.click(screen.getByRole("button", { name: "+ 문항 추가" }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** 답변 칸에 연결된(aria-describedby) 글자 수 글 */
const counterOf = (label: string) => {
  const id = screen.getByLabelText(label).getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : undefined;
};

/** 모든 칸을 채운다. 검사(zodResolver)는 비동기라 [저장하기]가 켜질 때까지 기다린다 */
async function fillAll() {
  type("회사명", "○○전자");
  type("직무", "백엔드 개발자");
  type("문항 1", "지원 동기");
  type("문항 1 답변", "저는…");
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
}

describe("ApplicationWriteForm (지원서 쓰기)", () => {
  it("처음에는 문항 1개(빼기 없음)와 그 문항의 글자 수 0 / 20,000을 보여 주고, [저장하기]는 비활성이다", () => {
    render(<ApplicationWriteForm from="applications" />);

    expect(screen.getByRole("heading", { level: 1, name: "지원서 쓰기" })).toBeTruthy();
    expect(screen.getByText("저장한 지원서는 여러 면접에 쓸 수 있어요")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /빼기$/ })).toBeNull();
    expect(counterOf("문항 1 답변")).toContain("글자 수 0 / 20,000");
    expect(save()).toHaveProperty("disabled", true);
  });

  it("[+ 문항 추가]를 누르면 문항이 늘고 새 문항 칸에 포커스가 가며, 문항이 2개 이상이면 문항마다 빼기가 보인다", () => {
    render(<ApplicationWriteForm from="applications" />);

    addQuestion();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(document.activeElement).toBe(screen.getByLabelText("문항 2"));
    expect(screen.getByRole("button", { name: "문항 1 빼기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "문항 2 빼기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "문항 1 빼기" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /빼기$/ })).toBeNull();
    // 누른 ✕가 사라지므로 포커스는 [+ 문항 추가]로 간다
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ 문항 추가" }));
  });

  it("가운데 문항을 빼면 남은 문항이 내용 · 글자 수와 함께 앞으로 당겨지고 번호가 다시 매겨진다", () => {
    render(<ApplicationWriteForm from="applications" />);
    addQuestion();
    addQuestion();
    type("문항 1", "지원 동기");
    type("문항 2", "협업 경험");
    type("문항 3", "입사 후 포부");
    type("문항 3 답변", "가나다");

    fireEvent.click(screen.getByRole("button", { name: "문항 2 빼기" }));

    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.slice(0, 2))).toEqual([
      "Q1",
      "Q2",
    ]);
    expect(screen.getByLabelText<HTMLInputElement>("문항 1").value).toBe("지원 동기");
    expect(screen.getByLabelText<HTMLInputElement>("문항 2").value).toBe("입사 후 포부");
    expect(screen.getByLabelText<HTMLTextAreaElement>("문항 2 답변").value).toBe("가나다");
    expect(counterOf("문항 2 답변")).toContain("글자 수 3 / 20,000");
    // 글자 수 id는 문항마다 달라 뺀 뒤에도 겹치지 않는다
    expect(screen.getByLabelText("문항 1 답변").getAttribute("aria-describedby")).not.toBe(
      screen.getByLabelText("문항 2 답변").getAttribute("aria-describedby"),
    );
  });

  it("글자 수는 문항마다 그 답변의 길이를 따로 센다", () => {
    render(<ApplicationWriteForm from="applications" />);
    addQuestion();

    type("문항 2 답변", "가나다");

    expect(counterOf("문항 2 답변")).toContain("글자 수 3 / 20,000");
    expect(counterOf("문항 1 답변")).toContain("글자 수 0 / 20,000");
    expect(screen.getByLabelText("문항 2 답변").getAttribute("maxLength")).toBe("20000");
    expect(screen.getByLabelText("문항 2").getAttribute("maxLength")).toBe("255");
  });

  // 기준: cover-letter-counter.tsx 출처 주석(모션 메모 지원서 쓰기 · 사용자 결정 2026-10-29 답변 20,000자):
  // 최대 200자 전을 넘으면 주황, 최대에 닿으면 빨강. 색만이 아니라 화면 낭독기 글로도 알린다.
  it.each([
    { length: 19_800, text: "글자 수 19,800 / 20,000", state: null },
    { length: 19_801, text: "글자 수 19,801 / 20,000", state: "최대 글자 수에 가까워요" },
    { length: 20_000, text: "글자 수 20,000 / 20,000", state: "최대 글자 수예요" },
  ])("답변이 $length자면 글자 수와 상태($state)를 읽어 준다", ({ length, text, state }) => {
    render(<ApplicationWriteForm from="applications" />);

    type("문항 1 답변", "가".repeat(length));

    const counter = counterOf("문항 1 답변");
    expect(counter).toContain(text);
    if (state) expect(counter).toContain(state);
    else expect(counter).not.toContain("최대 글자 수");
  });

  it("문항이 5개가 되면 [+ 문항 추가]가 사라지고, 하나를 빼면 다시 보이며 포커스가 그 버튼으로 간다", () => {
    render(<ApplicationWriteForm from="applications" />);
    for (let i = 0; i < 4; i += 1) addQuestion();

    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "+ 문항 추가" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "문항 5 빼기" }));

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    // 누른 ✕가 사라지고 [+ 문항 추가]가 다시 그려지면 포커스가 그 버튼으로 간다
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "+ 문항 추가" }));
  });

  it("모든 칸을 채우면 [저장하기]가 켜지고, 문항을 하나 더 만들어 비워 두면 다시 꺼진다", async () => {
    render(<ApplicationWriteForm from="applications" />);
    await fillAll();

    addQuestion();

    await waitFor(() => expect(save()).toHaveProperty("disabled", true));
  });

  it("저장하면 문항을 적은 순서대로 4.1로 보내고, 들어온 곳(from)을 넘긴다", async () => {
    createApplication.mockResolvedValue({});
    render(<ApplicationWriteForm from="practice" />);
    await fillAll();
    addQuestion();
    type("문항 2", "협업 경험");
    type("문항 2 답변", "함께했습니다.");
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));

    fireEvent.click(save());

    await waitFor(() =>
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
      ),
    );
  });

  it("가운데 문항을 빼고 저장하면 뺀 문항 없이 남은 문항을 적은 순서대로 4.1로 보낸다", async () => {
    createApplication.mockResolvedValue({});
    render(<ApplicationWriteForm from="applications" />);
    type("회사명", "○○전자");
    type("직무", "백엔드 개발자");
    addQuestion();
    addQuestion();
    type("문항 1", "지원 동기");
    type("문항 1 답변", "저는…");
    type("문항 2", "협업 경험");
    type("문항 2 답변", "함께했습니다.");
    type("문항 3", "입사 후 포부");
    type("문항 3 답변", "성장하겠습니다.");

    fireEvent.click(screen.getByRole("button", { name: "문항 2 빼기" }));
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));
    fireEvent.click(save());

    await waitFor(() =>
      expect(createApplication).toHaveBeenCalledWith(
        {
          companyName: "○○전자",
          jobTitle: "백엔드 개발자",
          coverLetterItems: [
            { question: "지원 동기", answer: "저는…" },
            { question: "입사 후 포부", answer: "성장하겠습니다." },
          ],
        },
        "applications",
      ),
    );
    expect(createApplication).toHaveBeenCalledTimes(1);
  });

  it("저장 응답을 기다리는 동안 [저장하기]를 막아 두 번 눌러도 4.1을 한 번만 보낸다", async () => {
    let respond!: (value: object) => void;
    createApplication.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    render(<ApplicationWriteForm from="applications" />);
    await fillAll();

    fireEvent.click(save());
    await waitFor(() => expect(save().getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(save());

    expect(save()).toHaveProperty("disabled", true);
    expect(createApplication).toHaveBeenCalledTimes(1);

    await act(async () => respond({}));
  });

  it("서버가 자기소개서를 거절하면(400 coverLetterItems) 자기소개서 아래에 서버 문구를 보여 준다", async () => {
    const reason =
      "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.";
    createApplication.mockResolvedValue({ fieldErrors: { coverLetterItems: reason } });
    render(<ApplicationWriteForm from="applications" />);
    await fillAll();

    fireEvent.click(save());

    const group = screen.getByRole("group", { name: "자기소개서" });
    expect((await within(group).findByRole("alert")).textContent).toBe(reason);
    expect(group.getAttribute("aria-describedby")).toBe("coverLetter-error");
  });

  it("서버가 회사명을 거절하면 회사명 칸 아래에 서버 문구를 보여 주고, 고치면 사라진다", async () => {
    createApplication.mockResolvedValue({ fieldErrors: { companyName: "1~100자입니다." } });
    render(<ApplicationWriteForm from="applications" />);
    await fillAll();

    fireEvent.click(save());

    expect((await screen.findByRole("alert")).textContent).toBe("1~100자입니다.");
    expect(screen.getByLabelText("회사명").getAttribute("aria-invalid")).toBe("true");

    type("회사명", "○○전자 본사");

    // 다시 검사(zodResolver)는 비동기라 그 결과를 기다린다.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("자기소개서를 판단하지 못하면(503) 폼 아래에 서버 문구를 보여 준다", async () => {
    createApplication.mockResolvedValue({
      formError: "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    render(<ApplicationWriteForm from="applications" />);
    await fillAll();

    fireEvent.click(save());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("자기소개서 거절(400 coverLetterItems) 뒤 다시 저장하면 지난 문구를 지우고 같은 내용으로 4.1을 다시 보낸다", async () => {
    const reason =
      "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.";
    createApplication
      .mockResolvedValueOnce({ fieldErrors: { coverLetterItems: reason } })
      .mockResolvedValueOnce({});
    render(<ApplicationWriteForm from="applications" />);
    await fillAll();

    fireEvent.click(save());

    const group = screen.getByRole("group", { name: "자기소개서" });
    expect((await within(group).findByRole("alert")).textContent).toBe(reason);
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));

    fireEvent.click(save());

    await waitFor(() => expect(within(group).queryByRole("alert")).toBeNull());
    expect(createApplication).toHaveBeenCalledTimes(2);
    expect(createApplication.mock.calls[1]).toEqual(createApplication.mock.calls[0]);
    expect(createApplication).toHaveBeenLastCalledWith(
      {
        companyName: "○○전자",
        jobTitle: "백엔드 개발자",
        coverLetterItems: [{ question: "지원 동기", answer: "저는…" }],
      },
      "applications",
    );
  });

  it("판단 실패(503) 뒤 다시 저장하면 폼 아래 문구를 지우고 같은 내용으로 4.1을 다시 보낸다", async () => {
    createApplication
      .mockResolvedValueOnce({
        formError: "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
      })
      .mockResolvedValueOnce({});
    render(<ApplicationWriteForm from="applications" />);
    await fillAll();

    fireEvent.click(save());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));

    fireEvent.click(save());

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(createApplication).toHaveBeenCalledTimes(2);
    expect(createApplication.mock.calls[1]).toEqual(createApplication.mock.calls[0]);
  });

  /** 문항 2개를 채워 저장하고 자기소개서 거절(400 coverLetterItems) 문구가 뜰 때까지 기다린다 */
  async function rejectWithTwoQuestions(reason: string) {
    createApplication.mockResolvedValue({ fieldErrors: { coverLetterItems: reason } });
    await fillAll();
    addQuestion();
    type("문항 2", "협업 경험");
    type("문항 2 답변", "함께했습니다.");
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));

    fireEvent.click(save());

    const group = screen.getByRole("group", { name: "자기소개서" });
    expect((await within(group).findByRole("alert")).textContent).toBe(reason);
    await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  }

  it("같은 주소로 새로 들어오면(push · replace로 bfcacheId가 바뀜) 문항 1개 · 빈 칸 · 문구 없이 처음부터 시작한다", async () => {
    const { rerender } = render(<ApplicationWriteForm from="applications" />);
    await rejectWithTwoQuestions("구체적으로 적어 주세요.");

    router.bfcacheId = "entry-2";
    rerender(<ApplicationWriteForm from="applications" />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByLabelText<HTMLInputElement>("회사명").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("직무").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("문항 1").value).toBe("");
    expect(screen.getByLabelText<HTMLTextAreaElement>("문항 1 답변").value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(save()).toHaveProperty("disabled", true);
  });

  it("뒤로 · 앞으로 가기로 돌아오면(bfcacheId 그대로) 문항 수 · 쓴 내용 · 서버 문구를 그대로 둔다", async () => {
    const reason = "구체적으로 적어 주세요.";
    const { rerender } = render(<ApplicationWriteForm from="applications" />);
    await rejectWithTwoQuestions(reason);

    rerender(<ApplicationWriteForm from="applications" />);

    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getByLabelText<HTMLInputElement>("회사명").value).toBe("○○전자");
    expect(screen.getByLabelText<HTMLInputElement>("직무").value).toBe("백엔드 개발자");
    expect(screen.getByLabelText<HTMLInputElement>("문항 1").value).toBe("지원 동기");
    expect(screen.getByLabelText<HTMLTextAreaElement>("문항 1 답변").value).toBe("저는…");
    expect(screen.getByLabelText<HTMLInputElement>("문항 2").value).toBe("협업 경험");
    expect(screen.getByLabelText<HTMLTextAreaElement>("문항 2 답변").value).toBe("함께했습니다.");
    const group = screen.getByRole("group", { name: "자기소개서" });
    expect(within(group).getByRole("alert").textContent).toBe(reason);
  });

  it.each([
    { from: "applications" as const, href: "/applications" },
    { from: "practice" as const, href: "/practice" },
  ])("[← 뒤로]는 들어온 곳($from)으로 간다", ({ from, href }) => {
    render(<ApplicationWriteForm from={from} />);

    expect(screen.getByRole("link", { name: "뒤로" }).getAttribute("href")).toBe(href);
  });
});
