import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toast } from "@/components/toast";
import { useToastStore } from "@/stores/toast-store";
import type { PracticeAlarmResponse } from "@/types/api";

import { ReminderCard } from "./reminder-card";

// 서버 액션 경계만 바꾼다. 카카오 동의 화면 이동 · 콜백(2.9)은 콜백 테스트와 E2E(settings.spec.ts)가 본다.
const startKakaoAlarm = vi.fn();
const disablePracticeAlarm = vi.fn();
const changePracticeAlarmTime = vi.fn();
vi.mock("@/lib/user/actions", () => ({
  startKakaoAlarm: (...args: unknown[]) => startKakaoAlarm(...args),
  disablePracticeAlarm: (...args: unknown[]) => disablePracticeAlarm(...args),
  changePracticeAlarmTime: (...args: unknown[]) => changePracticeAlarmTime(...args),
}));

// 기준: Figma S09-1 알림 카드(18:3223: 🔒 '카카오 연결 필요' · '카카오 계정 연결이 필요한 기능이에요' · 비활성) · S09-1-B(436:2104:
// '연습하지 않았다면 카카오톡으로 알려드릴게요' · '매일 21:00 ›' · 토글) · 기획 메모 S09-1 · S09-1-B(2.8 available · enabled · time,
// 켜기 → 카카오 동의, 끄기 → 2.11, 시간 › → 2.10(꺼져 있어도), 오류는 토스트 · 토글 · 시각은 그대로) · 모션 메모 S09-1(18:3261:
// available false면 누르면 아무 일 없음)
// 모션은 끄고 본다(사라지는 모션 시간에 기대지 않게). 끝나지 않는 서버 액션(외부 화면 이동 · 처리 중)은 테스트가 직접 풀고 끝낸다.

const ALARM_ON = { available: true, enabled: true, time: "21:00" } satisfies PracticeAlarmResponse;
const ALARM_OFF = {
  available: true,
  enabled: false,
  time: "07:30",
} satisfies PracticeAlarmResponse;
const UNAVAILABLE = {
  available: false,
  enabled: false,
  time: "21:00",
} satisfies PracticeAlarmResponse;

/** 테스트가 끝날 때 풀어 줄 처리 중인 서버 액션 */
const releases: (() => void)[] = [];
function pending<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (release = resolve));
  releases.push(() => release({} as T));
  return { promise, release };
}

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  useToastStore.setState({ toast: null });
});

afterEach(async () => {
  await act(async () => releases.splice(0).forEach((release) => release()));
  cleanup();
  vi.resetAllMocks();
  MotionGlobalConfig.skipAnimations = false;
});

/** 퇴장 모션(모션을 꺼도 다음 프레임에 끝난다)과 onExitComplete까지 흘려보낸다 */
async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

function renderCard(alarm: PracticeAlarmResponse) {
  return render(
    <>
      <ReminderCard alarm={alarm} />
      <Toast />
    </>,
  );
}

const toggle = () => screen.getByRole("switch", { name: "카카오톡 연습 알림" });
const timeButton = () => screen.getByRole("button", { name: /^알림 시간 매일/ });
const timeInput = () => screen.queryByLabelText("알림 시간");

describe("S09-1 카카오로 가입하지 않은 회원(2.8 available false)", () => {
  it("'카카오 연결 필요' 칩 · 안내와 함께 시간 · 토글을 누를 수 없고, 이유를 읽어 준다", () => {
    renderCard(UNAVAILABLE);

    expect(screen.getByText("카카오 연결 필요")).toBeTruthy();
    expect(screen.getByText("매일 21:00")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /알림 시간/ })).toBeNull();
    const disabled = screen.getByRole("switch", {
      name: "카카오톡 연습 알림",
      description: "카카오 계정 연결이 필요한 기능이에요",
    }) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
    expect(disabled.getAttribute("aria-checked")).toBe("false");
  });

  it("토글을 눌러도 아무 일이 없다", () => {
    renderCard(UNAVAILABLE);

    fireEvent.click(toggle());

    expect(startKakaoAlarm).not.toHaveBeenCalled();
    expect(disablePracticeAlarm).not.toHaveBeenCalled();
  });
});

describe("S09-1-B 카카오로 가입한 회원(2.8 available true)", () => {
  it("안내 문구 · 시간 · 켜진 토글을 보인다", () => {
    renderCard(ALARM_ON);

    expect(screen.queryByText("카카오 연결 필요")).toBeNull();
    expect(screen.getByText("연습하지 않았다면 카카오톡으로 알려드릴게요")).toBeTruthy();
    expect(screen.getByRole("button", { name: "알림 시간 매일 21:00, 바꾸기" })).toBeTruthy();
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("꺼진 토글을 누르면 카카오 메시지 동의를 시작하고, 넘어가는 동안 다시 누를 수 없다", async () => {
    startKakaoAlarm.mockReturnValue(pending().promise);
    renderCard(ALARM_OFF);

    await act(async () => fireEvent.click(toggle()));

    expect(startKakaoAlarm).toHaveBeenCalledWith();
    expect(disablePracticeAlarm).not.toHaveBeenCalled();
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(toggle().getAttribute("aria-busy")).toBe("true");
  });

  it("켜진 토글을 누르면 끈다(2.11)", async () => {
    disablePracticeAlarm.mockResolvedValue({});
    renderCard(ALARM_ON);

    await act(async () => fireEvent.click(toggle()));

    expect(disablePracticeAlarm).toHaveBeenCalledWith();
    expect(startKakaoAlarm).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")?.textContent ?? "").toBe("");
  });

  it.each([
    [
      "켜기",
      ALARM_OFF,
      startKakaoAlarm,
      "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    ],
    ["끄기", ALARM_ON, disablePracticeAlarm, "잠시 후 다시 시도해 주세요."],
  ])("%s가 실패하면 서버 문구를 토스트로 보이고 토글은 그대로", async (_, alarm, action, error) => {
    action.mockResolvedValue({ error });
    renderCard(alarm);

    await act(async () => fireEvent.click(toggle()));

    expect(screen.getByRole("status").textContent).toBe(error);
    expect(toggle().getAttribute("aria-checked")).toBe(String(alarm.enabled));
  });

  it("꺼진 상태에서도 '매일 HH:mm ›'로 시간을 바꿀 수 있고(2.10), 닫히면 그 버튼으로 포커스가 돌아온다", async () => {
    changePracticeAlarmTime.mockResolvedValue({});
    renderCard(ALARM_OFF);

    fireEvent.click(screen.getByRole("button", { name: "알림 시간 매일 07:30, 바꾸기" }));
    const input = timeInput() as HTMLInputElement;
    expect(input.value).toBe("07:30");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "22:30" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "저장" })));

    expect(changePracticeAlarmTime).toHaveBeenCalledWith({ time: "22:30" });
    await waitFor(() => expect(timeInput()).toBeNull());
    expect(document.activeElement).toBe(timeButton());
  });

  it("시각 저장이 실패하면 토스트로 알리고 편집 칸은 열어 둔다", async () => {
    changePracticeAlarmTime.mockResolvedValue({
      error: "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
    });
    renderCard(ALARM_ON);

    fireEvent.click(timeButton());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "저장" })));

    expect(screen.getByRole("status").textContent).toBe(
      "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
    );
    expect(timeInput()).toBeTruthy();
  });

  it("형식이 틀린 시각은 보내지 않고, 칸에 연결된 오류 문구로 알린다", async () => {
    renderCard(ALARM_ON);

    fireEvent.click(timeButton());
    fireEvent.change(timeInput()!, { target: { value: "" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "저장" })));

    expect(changePracticeAlarmTime).not.toHaveBeenCalled();
    const input = timeInput()!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "HH:mm 형식(00:00~23:59)입니다.",
    );
  });

  it("[취소] · Esc로 편집을 닫는다", async () => {
    renderCard(ALARM_ON);

    fireEvent.click(timeButton());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(timeInput()).toBeNull());

    fireEvent.click(timeButton());
    fireEvent.keyDown(timeInput()!, { key: "Escape" });
    await waitFor(() => expect(timeInput()).toBeNull());
    expect(changePracticeAlarmTime).not.toHaveBeenCalled();
  });

  it("저장하는 동안에는 Esc · [취소]로 닫지 않는다", async () => {
    changePracticeAlarmTime.mockReturnValue(pending().promise);
    renderCard(ALARM_ON);

    fireEvent.click(timeButton());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "저장" })));
    fireEvent.keyDown(timeInput()!, { key: "Escape" });
    // 닫혔다면 사라지는 모션까지 끝난 뒤에 본다
    await flushFrames();

    expect(timeInput()).toBeTruthy();
    expect((screen.getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("카카오 화면에서 뒤로 가기로 되살아나면(bfcache) 진행 중이던 토글을 다시 누를 수 있다", async () => {
    startKakaoAlarm.mockReturnValue(pending().promise);
    renderCard(ALARM_OFF);

    await act(async () => fireEvent.click(toggle()));
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);

    // 일반 pageshow(처음 열 때)는 아무것도 바꾸지 않는다
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect((toggle() as HTMLButtonElement).disabled).toBe(false);
  });
});
