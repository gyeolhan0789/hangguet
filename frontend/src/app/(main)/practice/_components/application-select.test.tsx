import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ComponentProps } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationListItem } from "@/types/api";

import { ApplicationSelect } from "./application-select";

// 기준: Figma S03 지원서 선택 · 기획 메모 S03 지원서 선택(지원서를 라디오로 고름, [+ 추가하기]는 항상 보임 → 지원서 쓰기,
// 고른 지원서 id로 S04) · Swagger 4.3 200 예시 · 사용자 결정(2026-10-29: 빈 목록이면 '저장된 지원서가 없어요')
// 실제 4.3 요청 · 이동은 E2E(practice.spec.ts)가 본다.

// next/form은 앱 라우터에 붙는다. 여기서는 보내는 주소 · 칸만 보면 되므로 보통 form으로 바꾼다.
vi.mock("next/form", () => ({
  default: (props: ComponentProps<"form">) => <form {...props} />,
}));

// 새로 들어올 때마다 새로 그리는 키(bfcacheId)만 쓴다. push · replace는 테스트가 값을 바꿔 흉내 낸다.
const router = vi.hoisted(() => ({ bfcacheId: "entry-1" }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});
beforeEach(() => {
  router.bfcacheId = "entry-1";
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});
afterEach(() => {
  cleanup();
});

const LIST = [
  {
    id: 12,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    createdAt: "2026-10-15T11:55:00+09:00",
  },
  {
    id: 9,
    companyName: "△△소프트",
    jobTitle: "서버 개발자",
    createdAt: "2026-10-11T20:10:00+09:00",
  },
] satisfies ApplicationListItem[];

const next = () => screen.getByRole("button", { name: "다음: 면접관 선택" });

describe("ApplicationSelect (S03 지원서 선택)", () => {
  it("1단계 표시 · 제목과 지원서마다 '회사 · 직무'와 작성일이 붙은 라디오를 보여 준다", () => {
    render(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);

    const steps = screen.getByRole("list", { name: "면접 준비 단계" });
    expect(within(steps).getAllByRole("listitem")[0].getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("heading", { level: 1, name: "어떤 면접을 준비하나요?" })).toBeTruthy();
    const group = screen.getByRole("group", { name: "지원서" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual([
      "○○전자 · 백엔드 개발자2026.10.15",
      "△△소프트 · 서버 개발자2026.10.11",
    ]);
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(["12", "9"]);
  });

  it("아무것도 고르지 않으면 [다음]이 꺼져 있고, 고르면 켜진다", () => {
    render(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);
    expect(next()).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("radio", { name: /△△소프트/ }));

    expect(screen.getByRole("radio", { name: /△△소프트/ })).toHaveProperty("checked", true);
    expect(next()).toHaveProperty("disabled", false);
  });

  it("골라 둔 지원서가 있으면 그 라디오가 선택된 채로 열린다", () => {
    render(<ApplicationSelect applications={LIST} initialSelected={9} added={false} />);

    expect(screen.getByRole("radio", { name: /△△소프트/ })).toHaveProperty("checked", true);
    expect(next()).toHaveProperty("disabled", false);
  });

  it("고른 지원서가 목록에서 빠지면(그사이 삭제) 고르지 않은 것으로 보고 [다음]을 끈다", () => {
    const { rerender } = render(
      <ApplicationSelect applications={LIST} initialSelected={9} added={false} />,
    );
    expect(next()).toHaveProperty("disabled", false);

    rerender(<ApplicationSelect applications={[LIST[0]]} initialSelected={9} added={false} />);

    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
    expect(next()).toHaveProperty("disabled", true);
  });

  it("같은 주소로 새로 들어오면(push · replace로 bfcacheId가 바뀜) 고른 것 없이 [다음]이 꺼진 채로 시작하고, 뒤로 · 앞으로 가기(bfcacheId 그대로)는 고른 값을 둔다", () => {
    const { rerender } = render(
      <ApplicationSelect applications={LIST} initialSelected={null} added={false} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /△△소프트/ }));

    rerender(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);
    expect(screen.getByRole("radio", { name: /△△소프트/ })).toHaveProperty("checked", true);
    expect(next()).toHaveProperty("disabled", false);

    router.bfcacheId = "entry-2";
    rerender(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);

    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
    expect(next()).toHaveProperty("disabled", true);
  });

  it("주소에 골라 둘 지원서가 있으면 새로 들어올 때 그 지원서부터 다시 고른다", () => {
    const { rerender } = render(
      <ApplicationSelect applications={LIST} initialSelected={9} added={false} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /○○전자/ }));

    router.bfcacheId = "entry-2";
    rerender(<ApplicationSelect applications={LIST} initialSelected={9} added={false} />);

    expect(screen.getByRole("radio", { name: /△△소프트/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: /○○전자/ })).toHaveProperty("checked", false);
  });

  it("고른 지원서 id(applicationId)를 S04 면접관 선택 주소로 보낸다", () => {
    render(<ApplicationSelect applications={LIST} initialSelected={12} added={false} />);

    const form = next().closest("form")!;
    expect(form.getAttribute("action")).toBe("/practice/interviewer");
    expect(new FormData(form).get("applicationId")).toBe("12");
  });

  it("[+ 추가하기]는 항상 보이고 S03에서 연 지원서 쓰기로 간다", () => {
    render(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);

    expect(screen.getByRole("link", { name: "+ 추가하기" }).getAttribute("href")).toBe(
      "/applications/new?from=practice",
    );
  });

  it("저장된 지원서가 없으면 안내와 [+ 추가하기]만 보이고 [다음]은 꺼져 있다", () => {
    render(<ApplicationSelect applications={[]} initialSelected={null} added={false} />);

    expect(screen.getByText("저장된 지원서가 없어요")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "+ 추가하기" })).toBeTruthy();
    expect(next()).toHaveProperty("disabled", true);
  });

  it("[← 홈으로]는 홈으로 간다", () => {
    render(<ApplicationSelect applications={LIST} initialSelected={null} added={false} />);

    expect(screen.getByRole("link", { name: "홈으로" }).getAttribute("href")).toBe("/home");
  });
});
