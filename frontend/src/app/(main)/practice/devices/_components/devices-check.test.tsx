// 기준: Figma S05 장치 점검(18:2333) · S05-E 권한 거부(18:4013) · 기획 메모 S05(18:752: 생성 완료 + 장치 모두 ✓일 때만 [면접 시작])
// · 기획 메모 S05-E(18:3468: [채팅으로 면접 보기] → S06-B) · 사용자 결정(2026-10-22: 면접관 3D 모델도 다 받아야 [면접 시작])
// · Swagger 5.1 면접 만들기 · 5.4 면접 시작(Idempotency-Key)
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { motionValue } from "motion/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VoiceCheck, VoiceStatus } from "@/components/use-voice-check";
import type { CheckStatus } from "@/lib/devices/media";
import { createSession, startSession, type SessionActionResult } from "@/lib/interview/actions";
import { preloadInterviewer } from "@/lib/interviewer/preload";
import { modePath } from "@/lib/routes";
import { useInterviewerPreloadStore, type PreloadStatus } from "@/stores/interviewer-preload-store";
import { deferred } from "@/test/deferred";
import type { Persona, SessionResponse } from "@/types/api";

import { DevicesCheck } from "./devices-check";
import type { DeviceCheck, NetworkStatus } from "./use-device-check";

// 경계 mock: 장치 점검 · 녹음 재생 훅(미디어 장치 · 오디오를 감싸는 우리 훅, 각자 전수 테스트)은 테스트가 정한 상태를 돌려준다
// · 서버 액션(5.1 · 5.3 · 5.4) · 면접관 3D 모델 받기 · Next 라우터 · 연출(motion) · 멱등 키 난수(crypto.randomUUID, 순번)
const hooks = vi.hoisted(() => ({
  devices: undefined as unknown as DeviceCheck,
  voice: undefined as unknown as VoiceCheck,
}));
vi.mock("./use-device-check", () => ({ useDeviceCheck: () => hooks.devices }));
vi.mock("@/components/use-voice-check", () => ({ useVoiceCheck: () => hooks.voice }));
vi.mock("@/lib/interview/actions", () => ({
  startSession: vi.fn(),
  createSession: vi.fn(),
  retryPlan: vi.fn(),
}));
vi.mock("@/lib/interviewer/preload", () => ({ preloadInterviewer: vi.fn() }));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("motion/react", async (importOriginal) =>
  (await import("@/test/motion")).reducedMotion(importOriginal),
);

let keys = 0;

/** 장치 상태를 정한다(기본: 카메라 · 마이크 · 네트워크 모두 확인됨) */
function setDevices(
  overrides: Partial<{ camera: CheckStatus; mic: CheckStatus; network: NetworkStatus }> = {},
) {
  hooks.devices = {
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

/** 녹음 · 재생 상태를 정한다(기본: [잘 들려요]로 확인함) */
function setVoice(status: VoiceStatus = "confirmed") {
  hooks.voice = { status, record: vi.fn(), play: vi.fn(), confirm: vi.fn() };
}

function setModel(status: PreloadStatus, persona: Persona = "DEVIL") {
  useInterviewerPreloadStore.setState({ persona, status, progress: status === "ready" ? 1 : 0.4 });
}

beforeEach(() => {
  keys = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `key-${++keys}` as ReturnType<typeof crypto.randomUUID>,
  );
  useInterviewerPreloadStore.setState(useInterviewerPreloadStore.getInitialState(), true);
  setModel("ready");
  setDevices();
  setVoice();
});

// 예시 데이터: Swagger 5.2 면접 조회(면접 55 · 지원서 10 · DEVIL · READY)
// · 실패 문구는 Swagger 5.1 · 5.4 409 IDEMPOTENCY_KEY_REUSED 예시 detail(대체 문구 RETRY_LATER와 다르다)
const SERVER_DETAIL = "이미 처리된 요청이에요.";
const FAILED: SessionActionResult = { formError: SERVER_DETAIL };

function renderCheck(planStatus: SessionResponse["planStatus"] = "READY") {
  return render(
    <DevicesCheck
      sessionId={55}
      applicationId={10}
      persona="DEVIL"
      planStatus={planStatus}
      planProgress={planStatus === "GENERATING" ? 78 : null}
    />,
  );
}

const startButton = () => screen.getByRole("button", { name: "면접 시작" });
const chatButton = () => screen.getByRole("button", { name: "채팅으로 면접 보기" });
/** 장치 점검 목록에서 제목으로 체크 줄을 찾는다 */
const row = (title: string) =>
  within(screen.getByRole("list", { name: "장치 점검" }))
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(title, { exact: true }))!;
const rowButton = (title: string, name: string) => within(row(title)).getByRole("button", { name });

/** [면접 시작]을 누르고, 테스트가 응답을 정하는 5.4 요청 하나를 돌려준다 */
function startWith() {
  const response = deferred<SessionActionResult>();
  vi.mocked(startSession).mockReturnValueOnce(response.promise);
  fireEvent.click(startButton());
  return response;
}

/** [채팅으로 면접 보기]를 누르고, 테스트가 응답을 정하는 5.1 요청 하나를 돌려준다 */
function chatWith() {
  const response = deferred<SessionActionResult>();
  vi.mocked(createSession).mockReturnValueOnce(response.promise);
  fireEvent.click(chatButton());
  return response;
}

describe("DevicesCheck · S05 장치 점검", () => {
  describe("면접관 모델", () => {
    describe("화면 표시", () => {
      it("다른 면접관의 모델을 받은 상태만 남아 있으면 아직 받기 전으로 보고 [면접 시작]을 끈다", () => {
        setModel("ready", "COFFEE_CHAT");

        renderCheck();

        expect(startButton().hasAttribute("disabled")).toBe(true);
        expect(screen.getByText("0%")).toBeDefined();
      });

      it("화면에 들어오면 이 면접관의 3D 모델을 미리 받는다", () => {
        renderCheck();

        expect(preloadInterviewer).toHaveBeenCalledTimes(1);
        expect(preloadInterviewer).toHaveBeenCalledWith("DEVIL");
      });
    });

    describe("사용자 조작", () => {
      it("모델 받기에 실패해 [다시 시도]를 누르면 이 면접관 모델을 다시 받는다", () => {
        setModel("failed");
        renderCheck();

        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

        expect(preloadInterviewer).toHaveBeenCalledTimes(2);
        expect(preloadInterviewer).toHaveBeenLastCalledWith("DEVIL");
      });
    });
  });

  describe("체크 줄", () => {
    describe("화면 표시", () => {
      it.each([
        { label: "확인 중", camera: "checking", text: "확인하고 있어요" },
        { label: "확인됨", camera: "ok", text: "잘 보이고 있어요" },
        { label: "실패", camera: "missing", text: "장치를 찾을 수 없어요" },
      ] as const)("카메라가 '$label'이면 카메라 줄에 '$text'를 보여 준다", ({ camera, text }) => {
        setDevices({ camera });

        renderCheck();

        expect(row("카메라").textContent).toContain(text);
      });

      it("인터넷이 끊기면 네트워크 줄을 실패로 보여 준다", () => {
        setDevices({ network: "offline" });

        renderCheck();

        expect(row("네트워크").textContent).toContain("인터넷 연결이 끊겼어요");
        expect(row("네트워크").textContent).toContain("확인 안 됨");
      });

      it.each([
        { title: "카메라", device: "camera" },
        { title: "마이크", device: "mic" },
      ] as const)(
        "'$title' 줄이 권한 거부가 아닌 실패면 그 줄에 [다시 확인]을 준다",
        ({ title, device }) => {
          setDevices({ [device]: "missing" });

          renderCheck();

          expect(rowButton(title, "다시 확인")).toBeDefined();
        },
      );

      it("권한 거부면 그 줄에 [다시 확인]을 주지 않는다", () => {
        setDevices({ camera: "denied" });

        renderCheck();

        expect(within(row("카메라")).queryByRole("button", { name: "다시 확인" })).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("줄의 [다시 확인]을 누르면 카메라 · 마이크를 다시 확인한다", () => {
        setDevices({ camera: "missing" });
        renderCheck();

        fireEvent.click(rowButton("카메라", "다시 확인"));

        expect(hooks.devices.recheck).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("마이크 · 스피커", () => {
    describe("화면 표시", () => {
      it("마이크를 받기 전에는 마이크 줄에 장치 상태만 보여 주고 [녹음하기]가 없다", () => {
        setDevices({ mic: "checking" });
        setVoice("idle");

        renderCheck();

        expect(row("마이크").textContent).toContain("확인하고 있어요");
        expect(within(row("마이크")).queryByRole("button", { name: "녹음하기" })).toBeNull();
      });

      it("녹음 전이면 마이크 줄에 [녹음하기]를 준다", () => {
        setVoice("idle");

        renderCheck();

        expect(rowButton("마이크", "녹음하기")).toBeDefined();
      });

      it("녹음 전이면 스피커 [들어보기]를 누를 수 없다", () => {
        setVoice("idle");

        renderCheck();

        expect(rowButton("스피커", "들어보기").hasAttribute("disabled")).toBe(true);
      });

      it("녹음 중이면 마이크 줄에 '지금 말해 보세요'와 누를 수 없는 [녹음 중]을 보여 준다", () => {
        setVoice("recording");

        renderCheck();

        expect(row("마이크").textContent).toContain("지금 말해 보세요");
        expect(rowButton("마이크", "녹음 중").hasAttribute("disabled")).toBe(true);
      });

      it.each(["recorded", "playing", "played", "confirmed", "playFailed"] as const)(
        "녹음이 끝난 '%s'면 마이크 줄을 확인됨으로 보여 준다",
        (status) => {
          setVoice(status);

          renderCheck();

          expect(row("마이크").textContent).toContain("목소리가 잘 들려요");
          expect(within(row("마이크")).getByText("확인됨")).toBeDefined();
        },
      );

      it("재생 중이면 스피커 줄에 '재생하고 있어요'와 누를 수 없는 [들어보기]를 보여 준다", () => {
        setVoice("playing");

        renderCheck();

        expect(row("스피커").textContent).toContain("재생하고 있어요");
        expect(rowButton("스피커", "들어보기").hasAttribute("disabled")).toBe(true);
      });

      it("재생이 끝나면 확인됨이 아니라 [들어보기] · [잘 들려요]를 준다", () => {
        setVoice("played");

        renderCheck();

        expect(within(row("스피커")).queryByText("확인됨")).toBeNull();
        expect(rowButton("스피커", "들어보기")).toBeDefined();
        expect(rowButton("스피커", "잘 들려요")).toBeDefined();
      });

      it("[잘 들려요]로 확인했으면 스피커 줄을 확인됨으로 보여 준다", () => {
        setVoice("confirmed");

        renderCheck();

        expect(within(row("스피커")).getByText("확인됨")).toBeDefined();
        expect(within(row("스피커")).queryByRole("button")).toBeNull();
      });

      it("녹음에 실패하면 마이크 줄에 실패 문구와 [다시 녹음]을 준다", () => {
        setVoice("recordFailed");

        renderCheck();

        expect(row("마이크").textContent).toContain("녹음하지 못했어요");
        expect(rowButton("마이크", "다시 녹음")).toBeDefined();
      });

      it("재생에 실패하면 스피커 줄에 실패 문구를 보여 준다", () => {
        setVoice("playFailed");

        renderCheck();

        expect(row("스피커").textContent).toContain("소리를 재생하지 못했어요");
      });
    });

    describe("사용자 조작", () => {
      it.each([
        { label: "녹음하기", status: "idle" },
        { label: "다시 녹음", status: "recordFailed" },
      ] as const)("'$label'을 누르면 녹음한다", ({ label, status }) => {
        setVoice(status);
        renderCheck();

        fireEvent.click(rowButton("마이크", label));

        expect(hooks.voice.record).toHaveBeenCalledTimes(1);
      });

      it.each(["recorded", "played", "playFailed"] as const)(
        "'%s'에서 [들어보기]를 누르면 녹음한 소리를 재생한다",
        (status) => {
          setVoice(status);
          renderCheck();

          fireEvent.click(rowButton("스피커", "들어보기"));

          expect(hooks.voice.play).toHaveBeenCalledTimes(1);
        },
      );

      it("[잘 들려요]를 누르면 스피커를 확인한다", () => {
        setVoice("played");
        renderCheck();

        fireEvent.click(rowButton("스피커", "잘 들려요"));

        expect(hooks.voice.confirm).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("면접 시작", () => {
    describe("화면 표시", () => {
      it("장치가 모두 확인되고 질문 준비 · 모델 받기가 끝나면 [면접 시작]을 누를 수 있다", () => {
        renderCheck();

        expect(startButton().hasAttribute("disabled")).toBe(false);
      });

      it.each<{
        label: string;
        devices?: Partial<{ camera: CheckStatus; mic: CheckStatus; network: NetworkStatus }>;
        voice?: VoiceStatus;
        plan?: SessionResponse["planStatus"];
        model?: PreloadStatus;
      }>([
        { label: "카메라 확인 중", devices: { camera: "checking" } },
        { label: "마이크 거부", devices: { mic: "denied" } },
        { label: "스피커 확인 전", voice: "played" },
        { label: "오프라인", devices: { network: "offline" } },
        { label: "질문 준비 중", plan: "GENERATING" },
        { label: "질문 준비 실패", plan: "FAILED" },
        { label: "모델 받는 중", model: "loading" },
        { label: "모델 받기 실패", model: "failed" },
      ])("'$label'이면 [면접 시작]을 누를 수 없다", ({ devices, voice, plan, model }) => {
        // 질문 준비 중이면 2초마다 다시 조회하는 타이머가 돌아 그 행만 가짜 타이머로 묶는다
        if (plan === "GENERATING") vi.useFakeTimers();
        setDevices(devices);
        setVoice(voice);
        if (model) setModel(model);

        renderCheck(plan);

        expect(startButton().hasAttribute("disabled")).toBe(true);
      });
    });

    describe("사용자 조작", () => {
      it("[면접 시작]을 누르면 이 면접을 멱등 키와 함께 시작한다", async () => {
        renderCheck();

        const response = startWith();

        expect(startSession).toHaveBeenCalledTimes(1);
        expect(vi.mocked(startSession).mock.calls[0][1]).toBe("key-1");
        await act(async () => response.resolve({}));
      });
    });

    describe("상태 변화", () => {
      it("서버가 실패로 답하지 않았으면 다시 누를 때 같은 멱등 키로 보낸다", async () => {
        renderCheck();
        const first = startWith();
        await act(async () => first.resolve(FAILED));

        const second = startWith();

        expect(vi.mocked(startSession).mock.calls.map(([, key]) => key)).toEqual([
          "key-1",
          "key-1",
        ]);
        await act(async () => second.resolve({}));
      });

      it("서버가 실패로 답했으면(keySpent) 다음에는 새 멱등 키로 보낸다", async () => {
        renderCheck();
        const first = startWith();
        await act(async () => first.resolve({ ...FAILED, keySpent: true }));

        const second = startWith();

        expect(vi.mocked(startSession).mock.calls.map(([, key]) => key)).toEqual([
          "key-1",
          "key-3",
        ]);
        await act(async () => second.resolve({}));
      });

      it("다시 시작하면 지난 실패 문구를 지운다", async () => {
        renderCheck();
        const first = startWith();
        await act(async () => first.resolve(FAILED));
        expect(screen.getByRole("alert").textContent).toBe(SERVER_DETAIL);

        const second = startWith();

        expect(screen.queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({}));
      });
    });

    describe("오류 처리", () => {
      it("시작하지 못하면 그 문구를 보여 준다", async () => {
        renderCheck();
        const response = startWith();

        await act(async () => response.resolve(FAILED));

        expect(screen.getByRole("alert").textContent).toBe(SERVER_DETAIL);
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("시작 응답을 기다리는 동안 [면접 시작]을 누를 수 없어 두 번 눌러도 한 번만 요청한다", async () => {
        renderCheck();
        const response = startWith();

        fireEvent.click(startButton());

        expect(startButton().hasAttribute("disabled")).toBe(true);
        expect(startSession).toHaveBeenCalledTimes(1);
        await act(async () => response.resolve({}));
      });
    });
  });

  describe("면접 방식으로 돌아가기", () => {
    describe("화면 표시", () => {
      it("[← 면접 방식]은 이 면접의 지원서 · 면접관으로 S05-1에 간다", () => {
        renderCheck();

        expect(screen.getByRole("link", { name: "면접 방식" }).getAttribute("href")).toBe(
          modePath(10, "DEVIL"),
        );
      });
    });
  });

  describe("권한 안내", () => {
    describe("화면 표시", () => {
      it.each(["camera", "mic"] as const)(
        "'%s' 권한이 거부되면 권한 안내 모달을 연다",
        (device) => {
          setDevices({ [device]: "denied" });

          renderCheck();

          expect(
            screen.getByRole("dialog", { name: "카메라 · 마이크 권한이 필요해요" }),
          ).toBeDefined();
        },
      );

      it("권한 거부가 없으면 권한 안내 모달을 열지 않는다", () => {
        setDevices({ camera: "missing" });

        renderCheck();

        expect(screen.queryByRole("dialog")).toBeNull();
      });
    });

    describe("사용자 조작", () => {
      it("모달의 [다시 확인하기]를 누르면 카메라 · 마이크를 다시 확인한다", () => {
        setDevices({ camera: "denied", mic: "denied" });
        renderCheck();

        fireEvent.click(screen.getByRole("button", { name: "다시 확인하기" }));

        expect(hooks.devices.recheck).toHaveBeenCalledTimes(1);
      });

      it("모달의 [채팅으로 면접 보기]를 누르면 같은 지원서 · 면접관으로 채팅 면접 만들기를 요청한다", async () => {
        setDevices({ camera: "denied", mic: "denied" });
        renderCheck();

        const response = chatWith();

        expect(createSession).toHaveBeenCalledWith(
          { applicationId: 10, persona: "DEVIL", mode: "CHAT" },
          "key-2",
        );
        await act(async () => response.resolve({}));
      });
    });

    describe("상태 변화", () => {
      it("서버가 실패로 답하지 않았으면 채팅 전환을 다시 할 때 같은 멱등 키로 보낸다", async () => {
        setDevices({ camera: "denied", mic: "denied" });
        renderCheck();
        const first = chatWith();
        await act(async () => first.resolve(FAILED));

        const second = chatWith();

        expect(vi.mocked(createSession).mock.calls.map(([, key]) => key)).toEqual([
          "key-2",
          "key-2",
        ]);
        await act(async () => second.resolve({}));
      });

      it("서버가 실패로 답했으면(keySpent) 다음 채팅 전환은 새 멱등 키로 보낸다", async () => {
        setDevices({ camera: "denied", mic: "denied" });
        renderCheck();
        const first = chatWith();
        await act(async () => first.resolve({ ...FAILED, keySpent: true }));

        const second = chatWith();

        expect(vi.mocked(createSession).mock.calls.map(([, key]) => key)).toEqual([
          "key-2",
          "key-3",
        ]);
        await act(async () => second.resolve({}));
      });

      it("채팅 전환을 다시 하면 지난 실패 문구를 지운다", async () => {
        setDevices({ camera: "denied", mic: "denied" });
        renderCheck();
        const first = chatWith();
        await act(async () => first.resolve(FAILED));
        expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeDefined();

        const second = chatWith();

        expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
        await act(async () => second.resolve({}));
      });
    });

    describe("오류 처리", () => {
      it("채팅 면접으로 바꾸지 못하면 모달 안에 그 문구를 보여 준다", async () => {
        setDevices({ camera: "denied", mic: "denied" });
        renderCheck();
        const response = chatWith();

        await act(async () => response.resolve(FAILED));

        expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(
          SERVER_DETAIL,
        );
      });
    });

    describe("중복 · 경쟁 처리", () => {
      it("채팅 전환 응답을 기다리는 동안 [채팅으로 면접 보기]를 누를 수 없다", async () => {
        setDevices({ camera: "denied", mic: "denied" });
        renderCheck();

        const response = chatWith();

        expect(chatButton().hasAttribute("disabled")).toBe(true);
        await act(async () => response.resolve({}));
        expect(chatButton().hasAttribute("disabled")).toBe(false);
      });
    });
  });
});
