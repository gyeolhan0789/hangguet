import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { Activity, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ApplicationResponse,
  ApplicationSessionListResponse,
  SessionListItem,
} from "@/types/api";

import { ApplicationDetail } from "./application-detail";

// 기준: Figma 지원 관리 · 상세 · 상세 · 면접에 씀 · 삭제 확인 · 기획 메모 지원 관리(면접 기록 줄: 분석 중 · 실패는 상태만)
// · 모션 메모 상세(하단 버튼은 페이지 끝에 닿으면 통통) · 모션 메모 삭제 확인(기다리는 동안 두 번 못 누름)
// · Swagger 4.2 200 예시(coverLetterItems) · 4.5 지원서 삭제 · 4.6 지원서의 연습 면접 목록
// · 사용자 결정(2026-10-29: [이 지원서로 면접 보기] → S04, 면접에 쓴 지원서도 [삭제], 삭제 실패면 모달 안에 서버 문구,
//   실패는 '분석 실패', 면접 기록이 한 쪽을 넘으면 '‹ 1 / N ›')
// 서버 액션 경계만 바꾼다. 실제 4.2 · 4.5 · 4.6 요청과 이동은 E2E(applications.spec.ts)가 본다.

const deleteApplication = vi.hoisted(() => vi.fn());
vi.mock("@/lib/application/actions", () => ({
  deleteApplication: (...args: unknown[]) => deleteApplication(...args),
}));

// 새로 들어올 때마다 상세를 새로 그리는 키(bfcacheId)만 쓴다. push · replace는 테스트가 값을 바꿔 흉내 낸다.
const router = vi.hoisted(() => ({ bfcacheId: "entry-1" }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// 하단 버튼 통통(useAnimate의 animate)만 바꾸고, 모달 퇴장 연출(AnimatePresence)은 바로 지우게 한다.
// 실제 시간(다음 프레임)을 기다리지 않기 위해서다. 나머지 motion은 그대로 쓴다.
const bounce = vi.hoisted(() => vi.fn());
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  const { useRef } = await import("react");
  return {
    ...actual,
    useAnimate: () => [useRef(null), bounce],
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
  };
});

/** 페이지 끝이 보이는지 알리는 IntersectionObserver(jsdom에 없다). 테스트가 '보였다'를 직접 알린다. */
const observers: { callback: IntersectionObserverCallback; targets: Element[] }[] = [];
function reachEnd() {
  act(() => {
    for (const { callback, targets } of observers) {
      callback(
        targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry),
        {} as IntersectionObserver,
      );
    }
  });
}

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});
beforeEach(() => {
  deleteApplication.mockReset();
  bounce.mockReset();
  router.bfcacheId = "entry-1";
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private entry: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback, targets: [] };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Swagger 4.2 200 예시
const APPLICATION = {
  id: 12,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    { itemOrder: 1, question: "지원 동기", answer: "저는…" },
    { itemOrder: 2, question: "협업 경험", answer: "4명이 함께한…\n함께했습니다." },
  ],
  createdAt: "2026-10-15T11:55:00+09:00",
} satisfies ApplicationResponse;

// Swagger 4.6 예시의 면접 하나(5.13과 같은 항목)
const SESSION = {
  id: 55,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "COMPLETED",
  startedAt: "2026-10-18T20:00:00+09:00",
  endedAt: "2026-10-18T20:20:00+09:00",
  answeredCount: 5,
  summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
  criterionGrades: [],
} satisfies SessionListItem;

const sessionsOf = (
  content: SessionListItem[],
  page: Partial<ApplicationSessionListResponse["page"]> = {},
): ApplicationSessionListResponse => ({
  content,
  page: { size: 10, number: 0, totalElements: content.length, totalPages: 1, ...page },
});

const NO_SESSIONS = sessionsOf([], { totalPages: 0 });

// 서버가 삭제를 거절했을 때의 문구(500 INTERNAL_ERROR 등)
const DELETE_FAILED = "서버에 문제가 생겼어요.";

function openDelete() {
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  return screen.getByRole("dialog", { name: "지원서를 삭제할까요?" });
}

describe("ApplicationDetail (지원서 상세)", () => {
  it("'‹ 지원 관리' · '회사 · 직무' 제목 · 작성일을 보여 준다", () => {
    render(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);

    expect(screen.getByRole("link", { name: "지원 관리" }).getAttribute("href")).toBe(
      "/applications",
    );
    expect(screen.getByRole("heading", { level: 1, name: "○○전자 · 백엔드 개발자" })).toBeTruthy();
    expect(screen.getByText("2026.10.15 작성")).toBeTruthy();
  });

  it("자기소개서 문항을 순서대로 Q 번호 · 문항 · 답변으로 보여 준다(답변의 줄바꿈은 그대로)", () => {
    render(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);

    const section = screen.getByRole("region", { name: "자기소개서" });
    expect(
      within(section)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Q1지원 동기저는…", "Q2협업 경험4명이 함께한…\n함께했습니다."]);
  });

  it("면접 기록이 없으면 '0회'와 빈 안내를 보여 주고 쪽 넘김은 없다", () => {
    render(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);

    const section = screen.getByRole("region", { name: "면접 기록" });
    expect(within(section).getByText("0회")).toBeTruthy();
    expect(within(section).getByText("아직 이 지원서로 본 면접이 없어요")).toBeTruthy();
    expect(within(section).queryByRole("navigation")).toBeNull();
  });

  it("면접 기록은 전체 횟수와 줄마다 '날짜 · 면접관 · 방식'을 보여 주고, 결과가 나온 면접만 총평과 결과 · 다시보기로 간다", () => {
    render(
      <ApplicationDetail
        application={APPLICATION}
        sessions={sessionsOf(
          [
            {
              ...SESSION,
              id: 54,
              persona: "COFFEE_CHAT",
              mode: "CHAT",
              status: "ANALYZING",
              startedAt: "2026-10-21T19:30:00+09:00",
              summary: null,
            },
            {
              ...SESSION,
              id: 53,
              status: "FAILED",
              startedAt: "2026-10-20T09:00:00+09:00",
              summary: "보이면 안 되는 총평",
            },
            SESSION,
          ],
          { totalElements: 12, totalPages: 2 },
        )}
      />,
    );

    const section = screen.getByRole("region", { name: "면접 기록" });
    expect(within(section).getByText("12회")).toBeTruthy();

    const analyzing = within(section).getByRole("article", {
      name: "10.21 · 개발자 커피챗 · 채팅",
    });
    expect(analyzing.textContent).toBe("10.21 · 개발자 커피챗 · 채팅분석 중");
    expect(within(analyzing).queryByRole("link")).toBeNull();
    // 분석 중에만 상태 글자 옆에 도는 스피너(글자 없는 아이콘)가 붙는다
    expect(within(analyzing).getByText("분석 중").querySelector("[aria-hidden]")).not.toBeNull();

    const failed = within(section).getByRole("article", { name: "10.20 · 악마 면접관 · 화상" });
    expect(failed.textContent).toBe("10.20 · 악마 면접관 · 화상분석 실패");
    expect(within(failed).queryByRole("link")).toBeNull();
    expect(within(failed).getByText("분석 실패").querySelector("[aria-hidden]")).toBeNull();

    const completed = within(section).getByRole("article", { name: "10.18 · 악마 면접관 · 화상" });
    expect(within(completed).getByText("논리는 탄탄했지만, 근거가 조금 아쉬웠어요")).toBeTruthy();
    expect(
      within(completed)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["상세 피드백›", "/interview/55/result"],
      ["다시보기›", "/interview/55/replay"],
    ]);
  });

  it("총평이 없는(null) 완료 면접은 총평 줄 없이 보여 준다", () => {
    render(
      <ApplicationDetail
        application={APPLICATION}
        sessions={sessionsOf([{ ...SESSION, summary: null }])}
      />,
    );

    expect(screen.getByRole("article", { name: "10.18 · 악마 면접관 · 화상" }).textContent).toBe(
      "10.18 · 악마 면접관 · 화상상세 피드백›다시보기›",
    );
  });

  it("면접 기록이 한 쪽뿐이면(totalPages 1) 쪽 넘김을 보여 주지 않는다", () => {
    render(
      <ApplicationDetail
        application={APPLICATION}
        sessions={sessionsOf([SESSION], { totalElements: 1, totalPages: 1 })}
      />,
    );

    const section = screen.getByRole("region", { name: "면접 기록" });
    expect(
      within(section).getByRole("article", { name: "10.18 · 악마 면접관 · 화상" }),
    ).toBeTruthy();
    expect(within(section).queryByRole("navigation")).toBeNull();
  });

  it.each([
    { number: 0, prev: null, next: "/applications/12?page=1", label: "1 / 3" },
    { number: 1, prev: "/applications/12", next: "/applications/12?page=2", label: "2 / 3" },
    { number: 2, prev: "/applications/12?page=1", next: null, label: "3 / 3" },
  ])(
    "면접 기록이 여러 쪽이면 '‹ $label ›'로 넘기고, 처음 · 끝 쪽의 화살표는 누를 수 없다",
    ({ number, prev, next, label }) => {
      render(
        <ApplicationDetail
          application={APPLICATION}
          sessions={sessionsOf([SESSION], { number, totalElements: 21, totalPages: 3 })}
        />,
      );

      const pager = within(screen.getByRole("region", { name: "면접 기록" })).getByRole(
        "navigation",
        { name: "페이지" },
      );
      expect(within(pager).getByText(label)).toBeTruthy();
      expect(
        within(pager).queryByRole("link", { name: "이전 페이지" })?.getAttribute("href") ?? null,
      ).toBe(prev);
      expect(
        within(pager).queryByRole("link", { name: "다음 페이지" })?.getAttribute("href") ?? null,
      ).toBe(next);
    },
  );

  it("면접에 쓴 지원서에도 [삭제]가 보인다", () => {
    render(<ApplicationDetail application={APPLICATION} sessions={sessionsOf([SESSION])} />);

    expect(screen.getByRole("button", { name: "삭제" })).toHaveProperty("disabled", false);
  });

  it("[이 지원서로 면접 보기]는 그 지원서로 S04 면접관 선택에 가고, 페이지 끝에 닿으면 통통 튄다", () => {
    render(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);

    expect(screen.getByRole("link", { name: "이 지원서로 면접 보기" }).getAttribute("href")).toBe(
      "/practice/interviewer?applicationId=12",
    );
    expect(bounce).not.toHaveBeenCalled();

    reachEnd();

    expect(bounce).toHaveBeenCalledTimes(1);
  });

  it("[삭제]를 누르면 설명이 연결된 확인 모달이 뜨고, [취소] · Esc로 닫히면 포커스가 [삭제]로 돌아온다", () => {
    render(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);
    const trigger = screen.getByRole("button", { name: "삭제" });

    const dialog = openDelete();
    const bodyId = dialog.getAttribute("aria-describedby");
    expect(bodyId && document.getElementById(bodyId)?.textContent).toBe(
      "삭제하면 되돌릴 수 없어요",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    openDelete();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(deleteApplication).not.toHaveBeenCalled();
  });

  it("같은 상세에 새로 들어오면(push · replace로 bfcacheId가 바뀜) 처음부터 다시 그려 페이지 끝 통통이 다시 나온다", () => {
    const { rerender } = render(
      <ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />,
    );
    const firstTitle = screen.getByRole("heading", { level: 1 });
    reachEnd();
    expect(bounce).toHaveBeenCalledTimes(1);

    // 뒤로 · 앞으로 가기(bfcacheId 그대로)는 그대로 두므로 다시 튀지 않는다
    rerender(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);
    reachEnd();
    expect(screen.getByRole("heading", { level: 1 })).toBe(firstTitle);
    expect(bounce).toHaveBeenCalledTimes(1);

    router.bfcacheId = "entry-2";
    rerender(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);
    expect(screen.getByRole("heading", { level: 1 })).not.toBe(firstTitle);
    reachEnd();

    expect(bounce).toHaveBeenCalledTimes(2);
  });

  it("같은 상세에 새로 들어오면(bfcacheId가 바뀜) 열려 있던 확인 모달은 닫힌 채로 시작한다", () => {
    const { rerender } = render(
      <ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />,
    );
    openDelete();

    router.bfcacheId = "entry-2";
    rerender(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("뒤로 · 앞으로 가기로 떠났다 돌아와도(bfcacheId 그대로, Activity로 숨김) 열려 있던 확인 모달과 지난 문구를 닫는다", async () => {
    deleteApplication.mockResolvedValue({ error: DELETE_FAILED });
    const { rerender } = render(
      <Activity mode="visible">
        <ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />
      </Activity>,
    );
    const dialog = openDelete();
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await within(dialog).findByRole("alert");

    rerender(
      <Activity mode="hidden">
        <ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />
      </Activity>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("모달의 [삭제]를 누르면 이 지원서를 지우고, 기다리는 동안 두 버튼을 막는다", async () => {
    let respond!: (value: object) => void;
    deleteApplication.mockReturnValue(new Promise((resolve) => (respond = resolve)));
    render(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);
    const dialog = openDelete();
    const confirm = within(dialog).getByRole("button", { name: "삭제" });

    fireEvent.click(confirm);

    await waitFor(() => expect(confirm.getAttribute("aria-busy")).toBe("true"));
    expect(confirm).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: "취소" })).toHaveProperty("disabled", true);
    expect(deleteApplication).toHaveBeenCalledWith(12);

    await act(async () => respond({ error: DELETE_FAILED }));
  });

  it("서버가 거절하면 모달 안에 서버 문구를 보여 주고, 다시 열면 지난 문구는 지운다", async () => {
    deleteApplication.mockResolvedValue({ error: DELETE_FAILED });
    render(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);
    const dialog = openDelete();

    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(DELETE_FAILED);
    // 문구가 먼저 그려지고, 삭제 요청(transition)이 끝나야 버튼이 다시 켜진다.
    const cancel = within(dialog).getByRole("button", { name: "취소" });
    await waitFor(() => expect(cancel).toHaveProperty("disabled", false));

    fireEvent.click(cancel);
    expect(screen.queryByRole("dialog")).toBeNull();
    const reopened = openDelete();

    expect(within(reopened).queryByRole("alert")).toBeNull();
  });
});
