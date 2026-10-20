import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { motionValue } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionActionResult } from "@/lib/interview/actions";
import type { SessionCreateRequest } from "@/types/api";

import { DevicesCheck } from "./devices-check";
import type { DeviceCheck } from "./use-device-check";
import type { VoiceCheck } from "./use-voice-check";

// 기준: 기획 메모 S05(18:752: 생성 완료 + 장치 모두 ✓일 때만 [면접 시작] 활성화) · Figma S05 · S05-E
// · Swagger 5.4 면접 시작 · 5.1 면접 만들기(Idempotency-Key, 409 IDEMPOTENCY_KEY_REUSED면 새 키)
// 장치 점검 hook(브라우저 장치)과 서버 액션 경계를 바꿔, 화면이 상태를 어떻게 보여 주고 무엇을 보내는지 본다.
// 실제 장치 · 서버 흐름은 E2E(practice-devices.spec.ts)가 맡는다.

let devices: DeviceCheck;
let voice: VoiceCheck;
vi.mock("./use-device-check", () => ({ useDeviceCheck: () => devices }));
vi.mock("./use-voice-check", () => ({ useVoiceCheck: () => voice }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const startSession = vi.fn<(sessionId: number, key: string) => Promise<SessionActionResult>>();
const createSession =
  vi.fn<(values: SessionCreateRequest, key: string) => Promise<SessionActionResult>>();
vi.mock("@/lib/interview/actions", () => ({
  startSession: (sessionId: number, key: string) => startSession(sessionId, key),
  createSession: (values: SessionCreateRequest, key: string) => createSession(values, key),
  retryPlan: vi.fn(),
}));

function setDevices(overrides: Partial<DeviceCheck> = {}) {
  devices = {
    stream: null,
    camera: "ok",
    mic: "ok",
    network: "ok",
    level: motionValue(0),
    rechecking: false,
    recheck: vi.fn(async () => true),
    ...overrides,
  };
}

function setVoice(status: VoiceCheck["status"] = "confirmed") {
  voice = { status, record: vi.fn(), play: vi.fn(), confirm: vi.fn() };
}

function checkView(planStatus: "GENERATING" | "READY" | "FAILED" = "READY") {
  return (
    <DevicesCheck
      sessionId={55}
      applicationId={10}
      persona="DEVIL"
      planStatus={planStatus}
      planProgress={planStatus === "GENERATING" ? 78 : null}
    />
  );
}

const renderCheck = (planStatus?: "GENERATING" | "READY" | "FAILED") =>
  render(checkView(planStatus));

const startButton = () => screen.getByRole("button", { name: "면접 시작" });
/** 장치 점검 목록에서 제목으로 체크 줄을 찾는다(진행 단계 목록과 섞이지 않게 목록 안에서만). */
const row = (title: string) =>
  within(screen.getByRole("list", { name: "장치 점검" }))
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(title, { exact: true }))!;
const UUID = /^[0-9a-f-]{36}$/;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DevicesCheck (S05 장치 점검 화면)", () => {
  it("장치 4개가 모두 확인되고 질문 준비가 끝나면 [면접 시작]이 켜진다", () => {
    setDevices();
    setVoice("confirmed");
    renderCheck("READY");

    expect(startButton().hasAttribute("disabled")).toBe(false);
  });

  it.each([
    { label: "카메라 확인 중", devices: { camera: "checking" }, voice: "confirmed", plan: "READY" },
    { label: "마이크 권한 거부", devices: { mic: "denied" }, voice: "confirmed", plan: "READY" },
    { label: "녹음 전", devices: {}, voice: "idle", plan: "READY" },
    { label: "녹음만 하고 재생 전", devices: {}, voice: "recorded", plan: "READY" },
    { label: "재생했지만 [잘 들려요] 전", devices: {}, voice: "played", plan: "READY" },
    { label: "오프라인", devices: { network: "offline" }, voice: "confirmed", plan: "READY" },
    { label: "질문 준비 중", devices: {}, voice: "confirmed", plan: "GENERATING" },
    { label: "질문 준비 실패", devices: {}, voice: "confirmed", plan: "FAILED" },
  ] as const)("$label이면 [면접 시작]이 꺼져 있다", (state) => {
    setDevices(state.devices);
    setVoice(state.voice);
    renderCheck(state.plan);

    expect(startButton().hasAttribute("disabled")).toBe(true);
  });

  it("[면접 시작]은 멱등 키와 함께 5.4를 부르고, 실패 문구를 보여 준다. 같은 키로 다시 보낸다", async () => {
    setDevices();
    setVoice("confirmed");
    startSession.mockResolvedValue({ formError: "면접관이 질문을 준비하고 있어요." });
    renderCheck();

    fireEvent.click(startButton());
    expect((await screen.findByRole("alert")).textContent).toBe("면접관이 질문을 준비하고 있어요.");
    await waitFor(() => expect(startButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(startButton());
    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(2));

    const [first, second] = startSession.mock.calls;
    expect(first).toEqual([55, expect.stringMatching(UUID)]);
    expect(second[1]).toBe(first[1]);
  });

  it("5.4가 409 IDEMPOTENCY_KEY_REUSED면 다음에는 새 키로 보낸다", async () => {
    setDevices();
    setVoice("confirmed");
    startSession.mockResolvedValue({ formError: "이미 처리된 요청이에요.", keyReused: true });
    renderCheck();

    fireEvent.click(startButton());
    await screen.findByRole("alert");
    await waitFor(() => expect(startButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(startButton());
    await waitFor(() => expect(startSession).toHaveBeenCalledTimes(2));

    const [first, second] = startSession.mock.calls;
    expect(second[1]).toMatch(UUID);
    expect(second[1]).not.toBe(first[1]);
  });

  // 둘 다 거부된 흐름은 E2E가 본다. 여기서는 모달이 열리는 조건만 본다.
  it("마이크 하나만 거부돼도 권한 안내 모달이 열린다", () => {
    setDevices({ mic: "denied" });
    setVoice("idle");
    renderCheck();

    expect(screen.getByRole("dialog", { name: "카메라 · 마이크 권한이 필요해요" })).toBeDefined();
  });

  it("[채팅으로 면접 보기]가 실패하면 모달에 문구를 보여 주고, 409 IDEMPOTENCY_KEY_REUSED면 다음에는 새 키로 만든다", async () => {
    setDevices({ camera: "denied", mic: "denied" });
    setVoice("idle");
    createSession.mockResolvedValue({ formError: "이미 처리된 요청이에요.", keyReused: true });
    renderCheck();
    const chat = () => screen.getByRole("button", { name: "채팅으로 면접 보기" });

    fireEvent.click(chat());
    const dialog = screen.getByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toBe("이미 처리된 요청이에요.");
    await waitFor(() => expect(chat().hasAttribute("disabled")).toBe(false));
    fireEvent.click(chat());
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

    const [first, second] = createSession.mock.calls;
    expect(first[0]).toEqual({ applicationId: 10, persona: "DEVIL", mode: "CHAT" });
    expect(second[1]).toMatch(UUID);
    expect(second[1]).not.toBe(first[1]);
  });

  it("권한 거부가 아닌 실패(장치 없음)면 모달 없이 그 줄의 [다시 확인]으로 다시 요청한다", () => {
    setDevices({ camera: "missing", mic: "missing" });
    setVoice("idle");
    renderCheck();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(row("카메라").textContent).toContain("장치를 찾을 수 없어요");
    fireEvent.click(within(row("카메라")).getByRole("button", { name: "다시 확인" }));

    expect(devices.recheck).toHaveBeenCalledTimes(1);
  });

  it("마이크 권한을 받으면 [녹음하기]가 있고, 녹음 전에는 스피커 [들어보기]가 꺼져 있다", () => {
    setDevices();
    setVoice("idle");
    renderCheck();

    fireEvent.click(within(row("마이크")).getByRole("button", { name: "녹음하기" }));

    expect(voice.record).toHaveBeenCalledTimes(1);
    expect(
      within(row("스피커")).getByRole("button", { name: "들어보기" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("녹음이 끝나면 마이크는 초록 체크, 스피커 [들어보기]가 켜지고 누르면 재생한다", () => {
    setDevices();
    setVoice("recorded");
    renderCheck();

    expect(row("마이크").textContent).toContain("목소리가 잘 들려요");
    expect(row("마이크").textContent).toContain("확인됨");
    fireEvent.click(within(row("스피커")).getByRole("button", { name: "들어보기" }));

    expect(voice.play).toHaveBeenCalledTimes(1);
  });

  it("재생이 끝나도 초록 체크가 아니라 [들어보기] · [잘 들려요]를 주고, [잘 들려요]를 눌러야 확인한다", () => {
    setDevices();
    setVoice("played");
    const { rerender } = renderCheck();

    expect(row("스피커").textContent).not.toContain("확인됨");
    fireEvent.click(within(row("스피커")).getByRole("button", { name: "들어보기" }));
    fireEvent.click(within(row("스피커")).getByRole("button", { name: "잘 들려요" }));
    expect(voice.play).toHaveBeenCalledTimes(1);
    expect(voice.confirm).toHaveBeenCalledTimes(1);

    setVoice("confirmed");
    rerender(checkView());

    expect(within(row("스피커")).queryByRole("button")).toBeNull();
    expect(row("스피커").textContent).toContain("확인됨");
  });

  it.each([
    {
      label: "녹음 실패",
      status: "recordFailed",
      text: "녹음하지 못했어요",
      title: "마이크",
      button: "다시 녹음",
      call: "record",
    },
    {
      label: "재생 실패",
      status: "playFailed",
      text: "소리를 재생하지 못했어요",
      title: "스피커",
      button: "들어보기",
      call: "play",
    },
  ] as const)(
    "$label → 그 줄에 실패 문구와 다시 하는 버튼을 준다",
    ({ status, title, text, button, call }) => {
      setDevices();
      setVoice(status);
      renderCheck();

      expect(row(title).textContent).toContain(text);
      fireEvent.click(within(row(title)).getByRole("button", { name: button }));

      expect(voice[call]).toHaveBeenCalledTimes(1);
    },
  );
});
