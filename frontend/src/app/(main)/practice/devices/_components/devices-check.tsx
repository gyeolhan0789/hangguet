"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";

import { PracticeActionBar, PracticeNextButton } from "@/components/practice/practice-action-bar";
import { PracticeSteps } from "@/components/practice/practice-steps";
import { useVoiceCheck, type VoiceCheck } from "@/components/use-voice-check";
import type { CheckStatus } from "@/lib/devices/media";
import { PLAY_TEXT, RECORD_TEXT } from "@/lib/devices/voice-text";
import { createSession, startSession } from "@/lib/interview/actions";
import { preloadInterviewer } from "@/lib/interviewer/preload";
import { modePath } from "@/lib/routes";
import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";
import type { SessionResponse } from "@/types/api";

import { CameraPreview } from "./camera-preview";
import { CheckRow, RowButton, type RowState } from "./check-row";
import { PermissionModal } from "./permission-modal";
import { PlanProgress } from "./plan-progress";
import { useDeviceCheck, type NetworkStatus } from "./use-device-check";

// 기준: Figma S05 장치 점검(18:2333: 단계 4 · 왼쪽 카메라 미리보기 600 · 오른쪽 체크 목록(제목 26 · 카메라 · 마이크 · 스피커
// · 네트워크 · 질문 준비) · [← 면접 방식] · [면접 시작 →]) · S05-E 권한 거부(18:4013)
// · 기획 메모 S05(18:752: 생성 완료 + 장치 모두 ✓일 때만 [면접 시작] 활성화, 권한 거부 시 안내 모달 + 다시 시도)
// · 사용자 결정(2026-10-22: 면접관 3D 모델도 다 받아야 [면접 시작] 활성화)
// · 기획 메모 S05-E(18:3468: [채팅으로 면접 보기] → S06-B) · Swagger 5.1 면접 만들기 · 5.4 면접 시작(Idempotency-Key)

/** 체크 줄 설명(Figma S05 · S05-E 문구. 확인 중 · 장치 없음 · 사용 중 · 끊김 · 미지원은 Figma에 없어 새로 정함) */
const DEVICE_TEXT = {
  camera: { ok: "잘 보이고 있어요" },
  mic: { ok: "목소리가 잘 들려요" },
} as const;

const FAILURE_TEXT: Record<Exclude<CheckStatus, "checking" | "ok">, string> = {
  denied: "권한이 없어요",
  missing: "장치를 찾을 수 없어요",
  busy: "다른 앱이 사용 중이에요",
  ended: "연결이 끊겼어요",
  unsupported: "이 브라우저에서는 확인할 수 없어요",
};

const NETWORK_TEXT: Record<NetworkStatus, string> = {
  checking: "확인하고 있어요",
  ok: "연결 상태 양호",
  offline: "인터넷 연결이 끊겼어요",
};

const rowState = (status: CheckStatus | NetworkStatus): RowState =>
  status === "checking" ? "checking" : status === "ok" ? "ok" : "fail";

const deviceText = (device: keyof typeof DEVICE_TEXT, status: CheckStatus) =>
  status === "checking"
    ? "확인하고 있어요"
    : status === "ok"
      ? DEVICE_TEXT[device].ok
      : FAILURE_TEXT[status];

export function DevicesCheck({
  sessionId,
  applicationId,
  persona,
  planStatus,
  planProgress,
}: Pick<SessionResponse, "applicationId" | "persona" | "planStatus" | "planProgress"> & {
  sessionId: SessionResponse["id"];
}) {
  const devices = useDeviceCheck();
  const voice = useVoiceCheck(devices.stream);
  const [formError, setFormError] = useState<string>();
  const [chatError, setChatError] = useState<string>();
  const [starting, startStarting] = useTransition();
  const [switching, startSwitching] = useTransition();
  // 5.4 · 5.1 멱등 키: 응답을 못 받아 다시 보내면 같은 키, 서버가 실패로 답했으면(keySpent) 새 키
  const [startKey, setStartKey] = useState(() => crypto.randomUUID());
  const [chatKey, setChatKey] = useState(() => crypto.randomUUID());

  // 질문을 준비하는 동안 면접관 3D 모델을 미리 받아 둔다(면접 화면에서 바로 그리도록).
  useEffect(() => {
    preloadInterviewer(persona);
  }, [persona]);
  // 다른 면접관의 상태가 남아 있으면 아직 받기 전으로 본다.
  const modelStatus = useInterviewerPreloadStore((state) =>
    state.persona === persona ? state.status : "idle",
  );
  const modelProgress = useInterviewerPreloadStore((state) =>
    state.persona === persona ? state.progress : 0,
  );

  const { camera, mic, network } = devices;
  const denied = camera === "denied" || mic === "denied";
  const micOn = mic === "ok";
  const recorded = ["recorded", "playing", "played", "confirmed", "playFailed"].includes(
    voice.status,
  );
  const ready =
    camera === "ok" &&
    micOn &&
    voice.status === "confirmed" &&
    network === "ok" &&
    planStatus === "READY" &&
    modelStatus === "ready";

  // 권한 거부가 아닌 실패(장치 없음 · 사용 중 · 끊김)는 줄 안의 [다시 확인]으로 다시 요청한다.
  const retryButton = (status: CheckStatus) =>
    status !== "checking" && status !== "ok" && status !== "denied" ? (
      <RowButton
        icon="/devices/icon-rotate-cw.svg"
        onClick={() => void devices.recheck()}
        pending={devices.rechecking}
      >
        다시 확인
      </RowButton>
    ) : undefined;

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || starting) return;
    setFormError(undefined);
    startStarting(async () => {
      const result = await startSession(sessionId, startKey);
      if (result.formError) setFormError(result.formError);
      if (result.keySpent) setStartKey(crypto.randomUUID());
    });
  }

  // S05-E [채팅으로 면접 보기]: 이미 만든 화상 면접의 방식을 바꾸는 API가 없어, 같은 지원서 · 면접관으로 채팅 면접을 새로 만든다(5.1).
  function switchToChat() {
    setChatError(undefined);
    startSwitching(async () => {
      const result = await createSession({ applicationId, persona, mode: "CHAT" }, chatKey);
      if (result.formError) setChatError(result.formError);
      if (result.keySpent) setChatKey(crypto.randomUUID());
    });
  }

  return (
    <form onSubmit={start} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
        <PracticeSteps current={4} />

        <div className="flex w-full max-w-[1040px] flex-col gap-8 lg:flex-row lg:items-start">
          <CameraPreview
            stream={devices.stream}
            cameraOn={camera === "ok"}
            micOn={micOn}
            level={devices.level}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-1.5 pb-2 leading-normal tracking-[-0.2px]">
              <h1 className="text-[26px] font-extrabold text-text-1">면접 전에 장치를 확인해요</h1>
              <p className="text-base font-medium text-text-2">
                모두 확인되면 바로 시작할 수 있어요
              </p>
            </div>

            <ul aria-label="장치 점검" aria-live="polite" className="flex flex-col gap-3">
              <CheckRow
                icon="/devices/icon-camera.svg"
                title="카메라"
                description={deviceText("camera", camera)}
                state={rowState(camera)}
                action={retryButton(camera)}
              />
              <CheckRow
                icon="/devices/icon-mic.svg"
                title="마이크"
                {...micRow(mic, voice, recorded, retryButton(mic))}
              />
              <CheckRow
                icon="/devices/icon-volume-2.svg"
                title="스피커"
                {...speakerRow(voice, recorded)}
              />
              <CheckRow
                icon="/devices/icon-wifi.svg"
                title="네트워크"
                description={NETWORK_TEXT[network]}
                state={rowState(network)}
              />
            </ul>

            <PlanProgress
              sessionId={sessionId}
              status={planStatus}
              progress={planProgress}
              model={{ status: modelStatus, progress: modelProgress }}
              onRetryModel={() => preloadInterviewer(persona)}
            />

            <AnimatePresence initial={false}>
              {formError && (
                <motion.p
                  key={formError}
                  role="alert"
                  className="text-sm leading-normal font-semibold text-danger"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  {formError}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <PracticeActionBar backHref={modePath(applicationId, persona)} backLabel="면접 방식">
        <PracticeNextButton disabled={!ready} pending={starting} pop="bounce">
          면접 시작
        </PracticeNextButton>
      </PracticeActionBar>

      <PermissionModal
        open={denied}
        rechecking={devices.rechecking}
        onRecheck={() => void devices.recheck()}
        switchingToChat={switching}
        onChat={switchToChat}
        error={chatError}
      />
    </form>
  );
}

type RowProps = Pick<Parameters<typeof CheckRow>[0], "description" | "state" | "action">;

/** 마이크 줄: 권한을 받으면 [녹음하기] → 3초 녹음 → 녹음이 끝나면 초록 체크 */
function micRow(
  mic: CheckStatus,
  voice: VoiceCheck,
  recorded: boolean,
  retry: ReactNode,
): RowProps {
  if (mic !== "ok") {
    return { description: deviceText("mic", mic), state: rowState(mic), action: retry };
  }
  if (recorded) return { description: DEVICE_TEXT.mic.ok, state: "ok" };
  switch (voice.status) {
    case "recording":
      return {
        description: RECORD_TEXT.recording,
        state: "checking",
        action: (
          <RowButton icon="/devices/icon-mic.svg" onClick={() => {}} pending>
            녹음 중
          </RowButton>
        ),
      };
    case "recordFailed":
      return {
        description: RECORD_TEXT.failed,
        state: "fail",
        action: (
          <RowButton icon="/devices/icon-mic.svg" onClick={voice.record}>
            다시 녹음
          </RowButton>
        ),
      };
    default:
      return {
        description: RECORD_TEXT.idle,
        state: "checking",
        action: (
          <RowButton icon="/devices/icon-mic.svg" onClick={voice.record}>
            녹음하기
          </RowButton>
        ),
      };
  }
}

/**
 * 스피커 줄: 녹음 전에는 [들어보기]가 꺼져 있다가, 녹음이 끝나면 켜지고, 누르면 녹음한 소리를 재생한다.
 * 다 들으면 [들어보기](다시 듣기) · [잘 들려요]를 주고, [잘 들려요]를 눌러야 초록 체크
 */
function speakerRow(voice: VoiceCheck, recorded: boolean): RowProps {
  switch (voice.status) {
    case "confirmed":
      return { description: PLAY_TEXT.confirmed, state: "ok" };
    case "played":
      return {
        description: PLAY_TEXT.played,
        state: "checking",
        action: (
          <span className="flex shrink-0 gap-2">
            <RowButton icon="/devices/icon-play.svg" onClick={voice.play}>
              들어보기
            </RowButton>
            <RowButton icon="/devices/icon-circle-check.svg" onClick={voice.confirm}>
              잘 들려요
            </RowButton>
          </span>
        ),
      };
    case "playing":
      return {
        description: PLAY_TEXT.playing,
        state: "checking",
        action: (
          <RowButton icon="/devices/icon-play.svg" onClick={() => {}} pending>
            들어보기
          </RowButton>
        ),
      };
    case "playFailed":
      return {
        description: PLAY_TEXT.failed,
        state: "fail",
        action: (
          <RowButton icon="/devices/icon-play.svg" onClick={voice.play}>
            들어보기
          </RowButton>
        ),
      };
    default:
      return {
        description: PLAY_TEXT.ready,
        state: "checking",
        action: (
          <RowButton icon="/devices/icon-play.svg" onClick={voice.play} disabled={!recorded}>
            들어보기
          </RowButton>
        ),
      };
  }
}
