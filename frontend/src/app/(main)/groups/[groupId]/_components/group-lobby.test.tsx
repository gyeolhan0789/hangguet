// 기준: Figma [초안] G01 그룹 면접 대기실(480:2414 · 483:2252 방장 · 모두 준비) · BE Swagger 10.4(2초마다 다시 부른다)
// · 10.5 준비(화상은 장치 점검 뒤) · 10.6 나가기 · 10.7 시작(방장만, 정원이 차고 모두 준비 · 질문 준비 완료, START_FAILED는 2명 이상)
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { leaveGroup, setGroupReady, startGroup } from "@/lib/group/actions";
import { retryPlan } from "@/lib/interview/actions";
import { router } from "@/test/next-navigation";
import type { GroupResponse, ParticipantResponse } from "@/types/api";

import { GroupLobby, LOBBY_POLL_MS } from "./group-lobby";

// 경계 mock: 서버 액션(10.5 · 10.6 · 10.7 · 5.3) · 카메라 · 마이크 점검(useLobbyDevices: 테스트가 장치 상태를 정한다)
// · 3D 모델 미리 받기 · 화면 이동 · 연출 · 멱등 키 난수
vi.mock("@/lib/group/actions", () => ({
  leaveGroup: vi.fn(async () => ({})),
  setGroupReady: vi.fn(async () => ({})),
  startGroup: vi.fn(async () => ({})),
}));
vi.mock("@/lib/interview/actions", () => ({ retryPlan: vi.fn(async () => ({})) }));
vi.mock("@/lib/interviewer/preload", () => ({ preloadInterviewer: vi.fn() }));
const devices = vi.hoisted(() => ({ ok: false }));
vi.mock("./lobby-devices", () => ({
  useLobbyDevices: (onReady: (ok: boolean) => void) => {
    useEffect(() => onReady(devices.ok), [onReady]);
    return { preview: null, rows: null };
  },
}));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

beforeEach(() => {
  devices.ok = true;
  vi.spyOn(crypto, "randomUUID").mockReturnValue("key-1" as ReturnType<typeof crypto.randomUUID>);
});

// 예시 데이터: BE Swagger 10.4 예시(그룹 7 · 방장 3 · 내 면접 55)
function member(patch: Partial<ParticipantResponse>): ParticipantResponse {
  return {
    userId: 3,
    nickname: "김하나",
    profileImageUrl: null,
    jobCategory: "DEVELOPMENT",
    sessionId: 55,
    planStatus: "READY",
    ready: true,
    turnOrder: null,
    state: "WAITING",
    ...patch,
  };
}
function group(patch: Partial<GroupResponse> = {}): GroupResponse {
  return {
    groupId: 7,
    status: "WAITING",
    mode: "CHAT",
    persona: "COFFEE_CHAT",
    jobCategory: "DEVELOPMENT",
    capacity: 2,
    inviteCode: "K7Q2ZP",
    hostUserId: 3,
    mySessionId: 55,
    participants: [member({}), member({ userId: 4, nickname: "이두리", sessionId: 56 })],
    jobCategoryMismatch: null,
    turn: null,
    room: null,
    ...patch,
  };
}

const button = (name: string) => screen.getByRole("button", { name });
const disabled = (name: string) => button(name).hasAttribute("disabled");

describe("GroupLobby · G01 그룹 면접 대기실", () => {
  describe("대기실", () => {
    describe("화면 표시", () => {
      it("정원보다 적으면 빈자리를 그 수만큼 보인다", () => {
        render(<GroupLobby group={group({ capacity: 3 })} planProgress={null} />);

        expect(screen.getAllByText("빈자리 · 초대를 기다려요")).toHaveLength(1);
      });

      it("방장이 준비했어도 준비하지 않은 사람이 있으면 [면접 시작]을 누를 수 없다", () => {
        const notReady = member({ userId: 4, sessionId: 56, ready: false });
        render(
          <GroupLobby
            group={group({ participants: [member({}), notReady] })}
            planProgress={null}
          />,
        );

        expect(disabled("면접 시작")).toBe(true);
      });

      it("질문을 준비하는 사람이 있으면 [면접 시작]을 누를 수 없다", () => {
        const generating = member({ userId: 4, sessionId: 56, planStatus: "GENERATING" });
        render(
          <GroupLobby
            group={group({ participants: [member({}), generating] })}
            planProgress={null}
          />,
        );

        expect(disabled("면접 시작")).toBe(true);
      });

      it("시작 실패(START_FAILED)면 정원보다 적어도 2명이 모두 준비했으면 [면접 시작]을 누를 수 있다", () => {
        render(
          <GroupLobby group={group({ status: "START_FAILED", capacity: 3 })} planProgress={null} />,
        );

        expect(disabled("면접 시작")).toBe(false);
      });

      it("방장이 준비했어도 자리가 다 차지 않았으면 [면접 시작]을 누를 수 없다", () => {
        render(<GroupLobby group={group({ capacity: 3 })} planProgress={null} />);

        expect(disabled("면접 시작")).toBe(true);
      });

      it("준비하지 않은 참가자는 '준비 전' 뱃지로 보인다", () => {
        const notReady = member({ userId: 4, sessionId: 56, ready: false });
        render(
          <GroupLobby
            group={group({ participants: [member({}), notReady] })}
            planProgress={null}
          />,
        );

        expect(screen.getByText("준비 전")).toBeDefined();
      });

      it("모두 질문 준비를 마쳤으면 그렇다고 보인다", () => {
        render(<GroupLobby group={group()} planProgress={null} />);

        expect(screen.getByText("모두 질문 준비를 마쳤어요")).toBeDefined();
      });

      it("방장이 아니면 [면접 시작] 대신 준비 버튼만 보인다", () => {
        render(<GroupLobby group={group({ hostUserId: 4 })} planProgress={null} />);

        expect(screen.queryByRole("button", { name: "면접 시작" })).toBeNull();
        expect(button("준비 취소")).toBeDefined();
      });

      it("내 질문을 준비하는 중이면 내 진행률을 보인다", () => {
        const generating = member({ planStatus: "GENERATING", ready: false });
        render(
          <GroupLobby
            group={group({ participants: [generating, member({ userId: 4, sessionId: 56 })] })}
            planProgress={50}
          />,
        );

        expect(screen.getByText("내 질문을 준비하고 있어요")).toBeDefined();
        expect(screen.getByText("50%")).toBeDefined();
      });
    });

    describe("사용자 조작", () => {
      it("방장이 [면접 시작]을 누르면 그룹 면접 시작을 요청한다", async () => {
        render(<GroupLobby group={group()} planProgress={null} />);

        await act(async () => fireEvent.click(button("면접 시작")));

        expect(startGroup).toHaveBeenCalledWith(7, "key-1");
      });

      it("[준비 완료]를 누르면 준비를 요청한다", async () => {
        const me = member({ ready: false });
        render(
          <GroupLobby
            group={group({ participants: [me, member({ userId: 4, sessionId: 56 })] })}
            planProgress={null}
          />,
        );

        await act(async () => fireEvent.click(button("준비 완료")));

        expect(setGroupReady).toHaveBeenCalledWith(7, true);
      });

      it("[나가기]를 누르면 그룹 나가기를 요청한다", async () => {
        render(<GroupLobby group={group()} planProgress={null} />);

        await act(async () => fireEvent.click(button("나가기")));

        expect(leaveGroup).toHaveBeenCalledWith(7);
      });

      it("[초대 링크 복사]를 누르면 초대 주소를 복사한다", async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
        render(<GroupLobby group={group()} planProgress={null} />);

        await act(async () => fireEvent.click(button("초대 링크 복사")));

        expect(writeText).toHaveBeenCalledWith(`${location.origin}/groups/invite/K7Q2ZP`);
      });
    });

    describe("상태 변화", () => {
      it.each([
        { label: "준비 중(GENERATING)", planStatus: "GENERATING", enabled: false },
        { label: "실패(FAILED)", planStatus: "FAILED", enabled: false },
        { label: "끝남(READY)", planStatus: "READY", enabled: true },
      ] as const)(
        "내 질문 준비가 $label이면 [준비 완료]를 누를 수 있는지가 $enabled다",
        ({ planStatus, enabled }) => {
          const me = member({ ready: false, planStatus });
          render(
            <GroupLobby
              group={group({ participants: [me, member({ userId: 4, sessionId: 56 })] })}
              planProgress={null}
            />,
          );

          expect(disabled("준비 완료")).toBe(!enabled);
        },
      );

      it("화상인데 카메라 · 마이크가 되지 않으면 [준비 완료]를 누를 수 없다", () => {
        devices.ok = false;
        const me = member({ ready: false });
        render(
          <GroupLobby
            group={group({
              mode: "VIDEO",
              participants: [me, member({ userId: 4, sessionId: 56 })],
            })}
            planProgress={null}
          />,
        );

        expect(disabled("준비 완료")).toBe(true);
      });
    });

    describe("오류 처리", () => {
      it("내 질문 준비에 실패했으면 알리고 [다시 시도]로 내 질문을 다시 준비한다", async () => {
        const failed = member({ planStatus: "FAILED", ready: false });
        render(
          <GroupLobby
            group={group({ participants: [failed, member({ userId: 4, sessionId: 56 })] })}
            planProgress={null}
          />,
        );
        expect(screen.getByText("면접 준비에 실패했어요")).toBeDefined();

        await act(async () => fireEvent.click(button("다시 시도")));

        expect(retryPlan).toHaveBeenCalledWith(55);
      });

      it("서버가 실패로 답했으면(keySpent) 다음 [면접 시작]은 새 멱등 키로 보낸다", async () => {
        let keys = 0;
        vi.mocked(crypto.randomUUID).mockImplementation(
          () => `key-${++keys}` as ReturnType<typeof crypto.randomUUID>,
        );
        vi.mocked(startGroup).mockResolvedValueOnce({
          formError: "준비하지 않은 사람이 있어요.",
          keySpent: true,
        });
        render(<GroupLobby group={group()} planProgress={null} />);
        await act(async () => fireEvent.click(button("면접 시작")));

        await act(async () => fireEvent.click(button("면접 시작")));

        expect(vi.mocked(startGroup).mock.calls.map(([, key]) => key)).toEqual(["key-1", "key-2"]);
      });

      it("시작하지 못하면 그 문구를 보여 준다", async () => {
        vi.mocked(startGroup).mockResolvedValueOnce({ formError: "준비하지 않은 사람이 있어요." });
        render(<GroupLobby group={group()} planProgress={null} />);

        await act(async () => fireEvent.click(button("면접 시작")));

        expect(screen.getByRole("alert").textContent).toBe("준비하지 않은 사람이 있어요.");
      });
    });

    describe("시간 경과", () => {
      it("다시 조회가 잠깐 실패해(undefined) 다시 그려도 직전에 받은 대기실을 그대로 보인다", () => {
        const { rerender } = render(<GroupLobby group={group()} planProgress={50} />);

        rerender(<GroupLobby group={undefined} planProgress={undefined} />);

        expect(screen.getByRole("heading", { name: "그룹 면접 대기실" })).toBeDefined();
        expect(button("면접 시작")).toBeDefined();
      });

      it("2초가 지나면 다시 그려 그룹을 다시 조회한다", () => {
        vi.useFakeTimers();
        render(<GroupLobby group={group()} planProgress={null} />);

        act(() => vi.advanceTimersByTime(LOBBY_POLL_MS));

        expect(router.refresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
