// 기준: Figma 지원 관리 · 상세 · 상세 · 면접에 씀 · 삭제 확인 · 기획 메모 지원 관리(면접 기록 줄: 분석 중 · 실패는 상태만)
// · 모션 메모 삭제 확인(기다리는 동안 두 번 못 누름)
// · Swagger 4.2 지원서 조회 · 4.5 지원서 삭제 · 4.6 지원서의 연습 면접 목록
// · 사용자 결정(2026-10-29: [이 지원서로 면접 보기] → S04, 삭제 실패면 모달 안에 서버 문구, 면접 기록이 한 쪽을 넘으면 '‹ 1 / N ›')
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteApplication, type DeleteApplicationResult } from "@/lib/application/actions";
import type {
  ApplicationResponse,
  ApplicationSessionListResponse,
  SessionListItem,
} from "@/types/api";
import { deferred } from "@/test/deferred";
import { flushPromises } from "@/test/flush";
import { router } from "@/test/next-navigation";
import { SESSION_LIST } from "@/test/session-list-examples";

import { ApplicationDetail } from "./application-detail";

// 경계 mock: 서버 액션(4.5) · Next 라우터(bfcacheId) · 연출(motion)은 건너뛰고 useInView(페이지 끝에 닿음)는 대역으로 둔다
vi.mock("@/lib/application/actions", () => ({ deleteApplication: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
const inView = vi.hoisted(() => vi.fn());
vi.mock("motion/react", async (importOriginal) => ({
  ...(await (await import("@/test/motion")).reducedMotion(importOriginal)),
  useInView: inView,
}));

// 예시 데이터: Swagger 4.2 200 '○○전자' · 4.6 200 '분석 중·실패' 예시, 결과가 나온 줄은 5.13 예시(같은 SessionListItem)
const APPLICATION: ApplicationResponse = {
  id: 12,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    {
      itemOrder: 1,
      question: "지원 동기",
      answer: "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어 지원했습니다.",
    },
    {
      itemOrder: 2,
      question: "협업 경험",
      answer: "4명이 함께한 프로젝트에서 API 설계를 맡았습니다.",
    },
  ],
  createdAt: "2026-10-15T11:55:00+09:00",
};
const ANALYZING: SessionListItem = {
  id: 54,
  companyName: "△△소프트",
  jobTitle: "서버 개발자",
  persona: "COFFEE_CHAT",
  mode: "CHAT",
  status: "ANALYZING",
  startedAt: "2026-10-21T19:30:00+09:00",
  endedAt: "2026-10-21T19:42:00+09:00",
  answeredCount: 3,
  summary: null,
  criterionGrades: [],
};
const COMPLETED = SESSION_LIST.DAILY.content[0];
const COMPLETED_NO_SUMMARY = SESSION_LIST.DAY_20.content[1];
const DELETE_FAILED = "서버에 문제가 생겼어요.";

function sessionsOf(
  content: SessionListItem[],
  page: Partial<ApplicationSessionListResponse["page"]> = {},
): ApplicationSessionListResponse {
  return {
    content,
    page: { size: 10, number: 0, totalElements: content.length, totalPages: 1, ...page },
  };
}
const NO_SESSIONS = sessionsOf([], { totalPages: 0 });

const renderDetail = (sessions = NO_SESSIONS) =>
  render(<ApplicationDetail application={APPLICATION} sessions={sessions} />);

/** 페이지의 [삭제]로 확인 모달을 연다 */
function openConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  return screen.getByRole("dialog", { name: "지원서를 삭제할까요?" });
}

/** 모달의 [삭제]를 누르고 결과가 반영되기를 기다린다 */
async function confirmDelete(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
  await flushPromises();
}

beforeEach(() => {
  inView.mockReturnValue(false);
});

describe("ApplicationDetail · 지원서 상세", () => {
  describe("지원서", () => {
    describe("화면 표시", () => {
      it("제목은 '회사 · 직무', 그 아래에 'YYYY.MM.DD 작성'을 보여 준다", () => {
        renderDetail();

        expect(
          screen.getByRole("heading", { level: 1, name: "○○전자 · 백엔드 개발자" }),
        ).toBeDefined();
        expect(screen.getByText("2026.10.15 작성")).toBeDefined();
      });

      it("[이 지원서로 면접 보기]는 이 지원서로 면접관 선택에 간다", () => {
        renderDetail();

        expect(
          screen.getByRole("link", { name: "이 지원서로 면접 보기" }).getAttribute("href"),
        ).toBe("/practice/interviewer?applicationId=12");
      });
    });
  });

  describe("면접 기록", () => {
    describe("화면 표시", () => {
      it("면접 기록이 없으면 '0회'와 '아직 이 지원서로 본 면접이 없어요'를 보여 준다", () => {
        renderDetail();

        const records = screen.getByRole("region", { name: "면접 기록" });
        expect(within(records).getByText("0회")).toBeDefined();
        expect(within(records).getByText("아직 이 지원서로 본 면접이 없어요")).toBeDefined();
      });

      it("결과가 나온 면접 줄은 총평과 상세 피드백 · 다시보기 링크를 보여 준다", () => {
        renderDetail(sessionsOf([COMPLETED]));

        const row = screen.getByRole("article");
        expect(within(row).getByText("논리는 탄탄했지만, 근거가 조금 아쉬웠어요")).toBeDefined();
        expect(within(row).getByRole("link", { name: "상세 피드백" }).getAttribute("href")).toBe(
          "/interview/55/result",
        );
        expect(within(row).getByRole("link", { name: "다시보기" }).getAttribute("href")).toBe(
          "/interview/55/replay",
        );
      });

      it("분석 중인 면접 줄은 상태만 보여 주고 링크 · 총평이 없다", () => {
        // 총평이 있어도 숨기는지 보려고 총평을 넣는다. 상태별 문구는 pendingLabel(records/format) 소관이라 대표 한 줄만 본다
        renderDetail(sessionsOf([{ ...ANALYZING, summary: "논리는 탄탄했어요" }]));

        const row = screen.getByRole("article");
        expect(within(row).getByText("분석 중")).toBeDefined();
        expect(within(row).queryByRole("link")).toBeNull();
        expect(within(row).queryByText("논리는 탄탄했어요")).toBeNull();
      });

      it("총평이 없는 완료 면접 줄은 총평 줄 없이 보여 준다", () => {
        renderDetail(sessionsOf([COMPLETED_NO_SUMMARY]));

        expect(screen.getByRole("article").textContent).toBe(
          "10.20 · 악마 면접관 · 채팅상세 피드백›다시보기›",
        );
      });

      it("면접 기록이 여러 쪽이면 쪽 넘김을 보여 주고 이 지원서의 다음 쪽 주소로 간다", () => {
        renderDetail(sessionsOf([ANALYZING], { totalElements: 11, totalPages: 2 }));

        const pager = screen.getByRole("navigation", { name: "페이지" });
        expect(within(pager).getByRole("link", { name: "다음 페이지" }).getAttribute("href")).toBe(
          "/applications/12?page=1",
        );
      });
    });

    describe("경계값", () => {
      it("면접 기록이 한 쪽뿐이면 쪽 넘김을 보여 주지 않는다", () => {
        renderDetail(sessionsOf([ANALYZING]));

        expect(screen.queryByRole("navigation", { name: "페이지" })).toBeNull();
      });
    });
  });

  describe("삭제 확인", () => {
    describe("사용자 조작", () => {
      it("[삭제]를 누르면 설명이 연결된 확인 모달을 연다", () => {
        renderDetail();

        fireEvent.click(screen.getByRole("button", { name: "삭제" }));

        expect(
          screen.getByRole("dialog", {
            name: "지원서를 삭제할까요?",
            description: "삭제하면 되돌릴 수 없어요",
          }),
        ).toBeDefined();
      });

      it("모달의 [취소]를 누르면 닫고 포커스를 [삭제]로 돌려준다", () => {
        renderDetail();
        const dialog = openConfirm();

        fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "삭제" }));
      });

      it("모달이 열린 상태에서 Esc를 누르면 닫는다", () => {
        renderDetail();
        openConfirm();

        fireEvent.keyDown(document, { key: "Escape" });

        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("모달의 [삭제]를 누르면 이 지원서 삭제를 요청한다", async () => {
        vi.mocked(deleteApplication).mockResolvedValue({});
        renderDetail();

        await confirmDelete(openConfirm());

        expect(deleteApplication).toHaveBeenCalledTimes(1);
        expect(deleteApplication).toHaveBeenCalledWith(12);
      });
    });

    describe("상태 변화", () => {
      it("실패 문구가 남은 채 모달을 다시 열면 지난 문구를 지운다", async () => {
        vi.mocked(deleteApplication).mockResolvedValue({ error: DELETE_FAILED });
        renderDetail();
        const dialog = openConfirm();
        await confirmDelete(dialog);
        expect(within(dialog).getByRole("alert")).toBeDefined();
        fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

        openConfirm();

        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("실패 문구가 있는 채 다시 [삭제]를 누르면 기다리는 동안 지난 문구를 지운다", async () => {
        const second = deferred<DeleteApplicationResult>();
        vi.mocked(deleteApplication)
          .mockResolvedValueOnce({ error: DELETE_FAILED })
          .mockReturnValueOnce(second.promise);
        renderDetail();
        const dialog = openConfirm();
        await confirmDelete(dialog);
        expect(within(dialog).getByRole("alert")).toBeDefined();

        fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

        expect(within(dialog).queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({}));
      });

      it("같은 상세에 새로 들어오면(bfcacheId가 바뀜) 열려 있던 모달은 닫힌 채로 시작한다", () => {
        const { rerender } = renderDetail();
        openConfirm();

        router.bfcacheId = "entry-2";
        rerender(<ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />);

        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("삭제가 실패하면 모달 안에 서버 문구를 보여 주고 모달을 그대로 둔다", async () => {
        const response = deferred<DeleteApplicationResult>();
        vi.mocked(deleteApplication).mockReturnValue(response.promise);
        renderDetail();
        const dialog = openConfirm();
        fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

        await act(async () => response.resolve({ error: DELETE_FAILED }));

        expect(screen.getByRole("dialog")).toBe(dialog);
        expect(within(dialog).getByRole("alert").textContent).toBe(DELETE_FAILED);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("삭제 응답을 기다리는 동안 [취소] · [삭제]를 누를 수 없다", async () => {
        const response = deferred<DeleteApplicationResult>();
        vi.mocked(deleteApplication).mockReturnValue(response.promise);
        renderDetail();
        const dialog = openConfirm();

        fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

        expect(within(dialog).getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(
          true,
        );
        expect(within(dialog).getByRole("button", { name: "삭제" }).hasAttribute("disabled")).toBe(
          true,
        );
        await act(async () => response.resolve({}));
      });

      it("삭제 응답을 기다리는 동안에는 Esc로 닫지 않는다", async () => {
        const response = deferred<DeleteApplicationResult>();
        vi.mocked(deleteApplication).mockReturnValue(response.promise);
        renderDetail();
        const dialog = openConfirm();
        fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

        fireEvent.keyDown(document, { key: "Escape" });

        expect(screen.getByRole("dialog")).toBe(dialog);
        await act(async () => response.resolve({}));
      });
    });

    describe("정리", () => {
      it("화면이 숨겨지면(Activity hidden) 열려 있던 모달과 지난 문구를 닫는다", async () => {
        vi.mocked(deleteApplication).mockResolvedValue({ error: DELETE_FAILED });
        const detail = <ApplicationDetail application={APPLICATION} sessions={NO_SESSIONS} />;
        const { rerender } = render(<Activity mode="visible">{detail}</Activity>);
        await confirmDelete(openConfirm());
        expect(screen.getByRole("alert")).toBeDefined();

        rerender(<Activity mode="hidden">{detail}</Activity>);
        rerender(<Activity mode="visible">{detail}</Activity>);

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });
});
