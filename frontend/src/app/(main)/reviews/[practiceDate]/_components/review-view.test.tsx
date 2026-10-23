import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterviewStore } from "@/stores/interview-store";
import { useToastStore } from "@/stores/toast-store";
import { GROWTH_REVIEW } from "@/test/growth-review-examples";
import type { GrowthReviewResponse } from "@/types/api";

import { ReviewView } from "./review-view";
import { SURVEY_DELAY_MS, surveySeenKey } from "./survey-modal";

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/reviews/2026-10-13",
}));

// 'N일째 달성!' 불 전환 · 레벨업은 자체 테스트(streak-celebration.test.tsx)가 본다. 여기서는 띄우는지와 넘기는 값만 본다.
vi.mock("@/components/streak/streak-celebration", () => ({
  StreakCelebration: ({
    days,
    leveledUp,
    onDone,
  }: {
    days: number;
    leveledUp: boolean;
    onDone: () => void;
  }) => (
    <div role="dialog" aria-label="스트릭 축하">
      {days}일 · 레벨업 {String(leveledUp)}
      <button type="button" onClick={onDone}>
        축하 끝
      </button>
    </div>
  ),
}));

// 기준: Figma S08(18:2710) · S08-B(18:4578) · S08-C(18:4720) · 기획 메모 S08 · S08-B · S08-C · 모션 메모 S08-B(진입 1.2초 뒤 설문)
// · 웹 Swagger 7.1 예시(S08 8일째 · S08-C 첫 면접) · 5.8 leveledUp
// · 사용자 결정(2026-10-22: 회색 점 목록은 빼고 nextActions를 큰 글씨로, 자소서 검증은 '좋아요'일 때만 [통과],
//   지난 날짜는 '오늘' 문구를 그날 문구로, S07에서 들어왔고 그날 첫 면접이면 'N일째 달성!'을 한 번, 설문은 오늘 리뷰에서만 ·
//   회원별 · 회차별로 한 번, 설문 주소의 {userId} · {streak} 자리를 채운다)

// Swagger 7.1 200 'S08 오늘의 성장 리뷰' · 'S08-C 첫 면접' 예시
const { S08, FIRST } = GROWTH_REVIEW;

/** 보조 기술이 읽는 글(aria-hidden으로 숨긴 숫자 애니메이션은 빼고 sr-only 값으로 읽는다) */
function spoken(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden]").forEach((hidden) => hidden.remove());
  return copy.textContent ?? "";
}

/** 7일 동그라미 칸들 */
const week = (name: string) => within(screen.getByRole("list", { name })).getAllByRole("listitem");

/** #RRGGBB → jsdom이 돌려주는 rgb(r, g, b) */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

const SURVEY_URL = "https://forms.test/s?entry.1={userId}&entry.2={streak}";

function view(review: GrowthReviewResponse, props: Partial<Parameters<typeof ReviewView>[0]> = {}) {
  return render(
    <ReviewView
      review={review}
      today
      fromResult={false}
      surveyUrl={SURVEY_URL}
      userId={1}
      {...props}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  useInterviewStore.getState().reset();
  useToastStore.getState().hide();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ReviewView · S08 (N일째)", () => {
  it("'8일째 연습 완료!', 그날 요약, 불꽃 단계 칩, 최근 7일을 보여 준다", () => {
    view(S08);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("8일째 연습 완료!");
    expect(screen.queryByText("10월 13일 · 오늘 면접 1회 · 18분")).not.toBeNull();
    expect(screen.queryByText("푸른 불꽃 · 8일째")).not.toBeNull();
    const week = within(screen.getByRole("list", { name: "최근 7일 연습" })).getAllByRole(
      "listitem",
    );
    expect(week.map((day) => day.textContent)).toEqual([
      "수 연습함",
      "목 연습함",
      "금 연습함",
      "토 연습함",
      "일 연습함",
      "월 연습함",
      "오늘 연습함",
    ]);
  });

  it("'오늘 나아진 점'은 오른 기준(+N)과 '좋아요'인 자소서 검증(통과)을, '다음에 해볼 것'은 목록 없이 nextActions만 보여 준다", () => {
    view(S08);

    const improved = screen.getByRole("region", { name: "오늘 나아진 점" });
    expect(within(improved).getAllByRole("listitem").map(spoken)).toEqual([
      "전달력+8말 끊김이 줄었어요",
      "논리성+4결론부터 말했어요",
      "자소서 검증통과막힘 없이 통과",
    ]);
    const next = screen.getByRole("region", { name: "다음에 해볼 것" });
    // 회색 점 목록 없이 nextActions 글만 둔다.
    expect(within(next).queryByRole("list")).toBeNull();
    expect(within(next).queryByText("직무 적합성 질문 1개 더 연습하기")).not.toBeNull();
    expect(within(next).queryByText("내일 홈에서 다시 알려드려요")).not.toBeNull();
  });

  it("[오늘은 여기까지]는 홈(S02-B)으로, [한 번 더 면접]은 S03 지원서 입력으로 간다", () => {
    view(S08);

    expect(screen.queryByText("한 번 더 할까요?")).not.toBeNull();
    expect(screen.getByRole("link", { name: "오늘은 여기까지" }).getAttribute("href")).toBe(
      "/home",
    );
    expect(screen.getByRole("link", { name: "한 번 더 면접" }).getAttribute("href")).toBe(
      "/practice",
    );
  });

  it("스트릭이 끊겼다가 다시 1일째면(첫 면접은 아님) S08 그대로 '1일째 연습 완료!' · 불씨 칩 · 오늘만 체크한 7일을 보여 준다", () => {
    view({ ...S08, streakOnDate: 1, practiceDates: ["2026-10-13"], comparedDate: "2026-10-09" });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("1일째 연습 완료!");
    expect(screen.queryByText("불씨 · 1일째")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "오늘 나아진 점" })).not.toBeNull();
    expect(screen.queryByRole("region", { name: "오늘의 기준점" })).toBeNull();
    expect(week("최근 7일 연습").map((day) => day.textContent)).toEqual([
      "수 연습 안 함",
      "목 연습 안 함",
      "금 연습 안 함",
      "토 연습 안 함",
      "일 연습 안 함",
      "월 연습 안 함",
      "오늘 연습함",
    ]);
  });

  it("최근 7일 중 연습 안 한 날이 섞여 있으면 연습한 날만 체크한다", () => {
    view({
      ...S08,
      streakOnDate: 3,
      practiceDates: ["2026-10-08", "2026-10-11", "2026-10-12", "2026-10-13"],
    });

    expect(week("최근 7일 연습").map((day) => day.textContent)).toEqual([
      "수 연습 안 함",
      "목 연습함",
      "금 연습 안 함",
      "토 연습 안 함",
      "일 연습함",
      "월 연습함",
      "오늘 연습함",
    ]);
  });

  // 오늘 칸 테두리는 그날 불꽃 단계의 위쪽 색(Figma S08 · 스트릭 뱃지 색상)
  it.each([
    [1, "#FF7A45"],
    [3, "#FFA766"],
    [6, "#FFD66B"],
    [8, "#7CC4FF"],
    [14, "#C9B6FF"],
  ])("%i일째면 오늘 칸 테두리가 그 단계 색(%s)이다", (days, color) => {
    view({ ...S08, streakOnDate: days });

    const current = week("최근 7일 연습").at(-1)!.firstElementChild as HTMLElement;
    expect(current.style.borderColor).toBe(rgb(color));
    expect(
      week("최근 7일 연습")
        .slice(0, -1)
        .map((day) => (day.firstElementChild as HTMLElement).style.borderColor),
    ).toEqual(Array(6).fill(""));
  });
});

describe("ReviewView · S08-C (첫 면접)", () => {
  it("'1일째 시작!' · 기준점 안내 · 앞으로의 7일('오늘 · +1 … +6')을 보여 준다", () => {
    view(FIRST);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("1일째 시작!");
    expect(screen.queryByText("첫 면접을 마쳤어요 · 오늘이 나의 기준점이에요")).not.toBeNull();
    expect(screen.queryByText("불씨 · 1일째")).not.toBeNull();
    const days = within(screen.getByRole("list", { name: "앞으로의 7일" })).getAllByRole(
      "listitem",
    );
    expect(days.map((day) => day.textContent)).toEqual([
      "오늘 연습함",
      "+1 연습 안 함",
      "+2 연습 안 함",
      "+3 연습 안 함",
      "+4 연습 안 함",
      "+5 연습 안 함",
      "+6 연습 안 함",
    ]);
  });

  it("나아진 점 대신 '오늘의 기준점' 4줄을 등급으로 보여 주고, '아쉬워요'만 빨간색이다", () => {
    view(FIRST);

    expect(screen.queryByText("오늘 나아진 점")).toBeNull();
    const base = screen.getByRole("region", { name: "오늘의 기준점" });
    const rows = within(base).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "직무 적합성좋아요",
      "자소서 검증아쉬워요",
      "논리성좋아요",
      "전달력보통",
    ]);
    expect(within(rows[1]).getByText("아쉬워요").className).toContain("text-danger");
    expect(within(base).queryByText("내일부터 나아진 점을 비교해 드려요")).not.toBeNull();
  });
});

describe("ReviewView · 지난 날짜", () => {
  it("S08: '오늘' 문구를 그날 문구로 바꾸고, 벨 안내를 숨기고, 버튼을 [홈으로] · [면접 연습하기]로 바꾼다", () => {
    view(S08, { today: false });

    expect(screen.queryByText("10월 13일 · 면접 1회 · 18분")).not.toBeNull();
    expect(screen.queryByText("이날 나아진 점")).not.toBeNull();
    expect(screen.queryByText("내일 홈에서 다시 알려드려요")).toBeNull();
    expect(screen.queryByText("오늘도 연습해 볼까요?")).not.toBeNull();
    expect(screen.getByRole("link", { name: "홈으로" }).getAttribute("href")).toBe("/home");
    expect(screen.getByRole("link", { name: "면접 연습하기" }).getAttribute("href")).toBe(
      "/practice",
    );
    const week = within(screen.getByRole("list", { name: "최근 7일 연습" })).getAllByRole(
      "listitem",
    );
    expect(week.at(-1)?.textContent).toBe("화 연습함");
  });

  it("S08-C: '이날의 기준점'과 지난 비교 안내를 보여 준다", () => {
    view(FIRST, { today: false });

    expect(screen.queryByText("첫 면접을 마쳤어요 · 이날이 나의 기준점이에요")).not.toBeNull();
    expect(screen.queryByText("이날의 기준점")).not.toBeNull();
    expect(screen.queryByText("다음 연습부터 나아진 점을 비교했어요")).not.toBeNull();
  });
});

describe("ReviewView · S08-B 설문 유도", () => {
  const THIRD = { ...S08, streakOnDate: 3 };
  const dialog = () => screen.queryByRole("dialog", { name: "1분만 의견을 들려주세요" });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  it("3일째 오늘 리뷰에 들어오고 1.2초 뒤 설문을 띄운다", () => {
    view(THIRD);

    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS - 1));
    expect(dialog()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(dialog()?.textContent).toContain("3일 동안 연습해보니 어땠나요?");
  });

  it.each([
    { label: "설문 회차가 아니면(8일째)", review: S08, props: {} },
    { label: "지난 날짜면", review: THIRD, props: { today: false } },
    { label: "설문 주소가 없으면", review: THIRD, props: { surveyUrl: null } },
  ])("$label 띄우지 않는다", ({ review, props }) => {
    view(review, props);

    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS * 5));
    expect(dialog()).toBeNull();
  });

  it("[설문 참여하기]는 회원 id · 스트릭을 채운 주소를 새 탭으로 열고, 돌아오면 '고마워요!'를 띄우며, 다시 들어와도 안 띄운다", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { unmount } = view(THIRD);
    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS));

    fireEvent.click(screen.getByRole("button", { name: "설문 참여하기" }));

    expect(open).toHaveBeenCalledWith(
      "https://forms.test/s?entry.1=1&entry.2=3",
      "_blank",
      "noopener,noreferrer",
    );
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(surveySeenKey(1, 3))).toBe("joined");
    // 설문 탭으로 갔다가(hidden) 돌아오면(visible) 고마움을 전한다.
    let visibility: DocumentVisibilityState = "hidden";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByRole("status")?.textContent ?? "").not.toContain("고마워요!");
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("status").textContent).toContain("고마워요!");

    unmount();
    view(THIRD);
    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS * 5));
    expect(dialog()).toBeNull();
  });

  it.each([
    {
      label: "[다음에 할게요]",
      close: () => fireEvent.click(screen.getByRole("button", { name: "다음에 할게요" })),
    },
    {
      label: "닫기(X)",
      close: () => fireEvent.click(screen.getByRole("button", { name: "닫기" })),
    },
    {
      label: "Esc",
      close: () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }),
    },
  ])("$label로 닫으면 이 회차는 다시 띄우지 않는다", ({ close }) => {
    view(THIRD);
    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS));

    close();

    expect(dialog()).toBeNull();
    expect(localStorage.getItem(surveySeenKey(1, 3))).toBe("later");
  });

  it("열리면 대화상자 안 첫 버튼에 초점이 가고, Tab · Shift+Tab은 대화상자 안에서만 돈다(WAI-ARIA APG)", () => {
    view(THIRD);
    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS));

    const buttons = within(dialog()!).getAllByRole("button");
    const first = buttons[0];
    const last = buttons.at(-1)!;
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("다른 회원이 본 회차 기록은 이 회원에게 영향을 주지 않는다", () => {
    localStorage.setItem(surveySeenKey(2, 3), "joined");
    view(THIRD);

    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS));
    expect(dialog()).not.toBeNull();
  });
});

describe("ReviewView · 면접을 마치고 들어왔을 때('N일째 달성!')", () => {
  it("S07에서 들어왔고 그날 첫 면접이면 축하를 먼저 띄우고(레벨업은 5.8 값), 끝나면 리뷰를 보여 주며 들어온 표시를 지운다", () => {
    useInterviewStore.getState().setLeveledUp(true);
    view(S08, { fromResult: true });

    expect(screen.getByRole("dialog", { name: "스트릭 축하" }).textContent).toContain(
      "8일 · 레벨업 true",
    );
    expect(screen.queryByText("오늘 나아진 점")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "축하 끝" }));

    expect(screen.queryByText("오늘 나아진 점")).not.toBeNull();
    expect(replace).toHaveBeenCalledWith("/reviews/2026-10-13", { scroll: false });
    expect(useInterviewStore.getState().leveledUp).toBeNull();
  });

  it("5.8 레벨업 값을 모르면(새로고침 등) 레벨업 없이 축하한다", () => {
    view(S08, { fromResult: true });

    expect(screen.getByRole("dialog", { name: "스트릭 축하" }).textContent).toContain(
      "레벨업 false",
    );
  });

  it("3일째(설문 회차)면 축하가 끝난 뒤부터 1.2초를 세어 설문을 띄운다", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    view({ ...S08, streakOnDate: 3 }, { fromResult: true });

    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS * 5));
    expect(screen.queryByRole("dialog", { name: "1분만 의견을 들려주세요" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "축하 끝" }));
    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS - 1));
    expect(screen.queryByRole("dialog", { name: "1분만 의견을 들려주세요" })).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog", { name: "1분만 의견을 들려주세요" })).not.toBeNull();
  });

  it("자정을 넘겨 열었으면(S07에서 왔지만 그날이 오늘이 아님) 축하는 띄우고, 리뷰는 '이날' 문구로, 설문은 띄우지 않는다", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    view({ ...S08, streakOnDate: 3 }, { fromResult: true, today: false });

    expect(screen.queryByRole("dialog", { name: "스트릭 축하" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "축하 끝" }));

    expect(screen.queryByRole("region", { name: "이날 나아진 점" })).not.toBeNull();
    act(() => vi.advanceTimersByTime(SURVEY_DELAY_MS * 5));
    expect(screen.queryByRole("dialog", { name: "1분만 의견을 들려주세요" })).toBeNull();
  });

  it.each([
    { label: "S07에서 들어온 게 아니면", props: { fromResult: false }, review: S08 },
    {
      label: "그날 두 번째 면접이면(스트릭이 이미 올랐음)",
      props: { fromResult: true },
      review: { ...S08, interviewCount: 2 },
    },
  ])("$label 축하 없이 바로 리뷰를 보여 준다", ({ props, review }) => {
    view(review, props);

    expect(screen.queryByRole("dialog", { name: "스트릭 축하" })).toBeNull();
    expect(screen.queryByText("오늘 나아진 점")).not.toBeNull();
  });
});
