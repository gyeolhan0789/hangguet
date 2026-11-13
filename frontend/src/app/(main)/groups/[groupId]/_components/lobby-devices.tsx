"use client";

import { useEffect } from "react";

import { CameraPreview } from "@/app/(main)/practice/devices/_components/camera-preview";
import {
  CheckRow,
  RowButton,
  toRowState,
} from "@/app/(main)/practice/devices/_components/check-row";
import { PermissionModal } from "@/app/(main)/practice/devices/_components/permission-modal";
import { useDeviceCheck } from "@/app/(main)/practice/devices/_components/use-device-check";
import { deviceText } from "@/lib/devices/device-text";
import type { CheckStatus } from "@/lib/devices/media";

// 기준: Figma [초안] G01(480:2414: 왼쪽 카메라 미리보기(S05와 같은 모양) · 오른쪽 카메라 · 마이크 줄) · BE Swagger 10.5
// ('화상은 장치 점검을 마친 뒤 부른다'). S05의 카메라 미리보기 · 체크 줄 · 장치 점검을 그대로 쓴다.
// 대기실 줄은 Figma에 카메라 · 마이크 둘뿐이라, 녹음 · 스피커 · 네트워크 확인은 두지 않는다.
// · 사용자 결정(2026-11-13, 빈칸 기본안): 실패하면 S05처럼 줄 안 [다시 확인], 권한 거부면 S05 권한 안내 모달(방식은 방장이 정해 채팅
//   전환은 없다), 이어폰 안내 문구 · 그룹 설계 6.8 [결정](대기실에서 이어폰 사용을 안내)

/** 카메라 미리보기(왼쪽)와 카메라 · 마이크 줄(오른쪽 칸에 넣는다). 둘 다 되면 onReady(true) */
export function useLobbyDevices(onReady: (ok: boolean) => void) {
  const devices = useDeviceCheck();
  const ok = devices.camera === "ok" && devices.mic === "ok";
  useEffect(() => {
    onReady(ok);
  }, [ok, onReady]);

  const preview = (
    <CameraPreview
      stream={devices.stream}
      cameraOn={devices.camera === "ok"}
      micOn={devices.mic === "ok"}
      level={devices.level}
    />
  );
  const rows = (
    <ul aria-label="장치 점검" aria-live="polite" className="flex flex-col gap-3">
      <CheckRow
        icon="/devices/icon-camera.svg"
        title="카메라"
        description={deviceText("camera", devices.camera)}
        state={toRowState(devices.camera)}
        action={retryButton(devices.camera)}
      />
      <CheckRow
        icon="/devices/icon-mic.svg"
        title="마이크"
        description={deviceText("mic", devices.mic)}
        state={toRowState(devices.mic)}
        action={retryButton(devices.mic)}
      />
      <li className="px-1 text-[13px] leading-normal font-medium text-text-3">
        다른 사람 목소리가 섞이지 않게 이어폰을 써 주세요
      </li>
    </ul>
  );
  const permission = (
    <PermissionModal
      open={devices.camera === "denied" || devices.mic === "denied"}
      rechecking={devices.rechecking}
      onRecheck={() => void devices.recheck()}
    />
  );
  return { preview, rows, permission };

  /** 권한 거부가 아닌 실패(장치 없음 · 사용 중 · 끊김)는 줄 안의 [다시 확인]으로 다시 요청한다(S05와 같다) */
  function retryButton(status: CheckStatus) {
    if (status === "checking" || status === "ok" || status === "denied") return undefined;
    return (
      <RowButton
        icon="/devices/icon-rotate-cw.svg"
        onClick={() => void devices.recheck()}
        pending={devices.rechecking}
      >
        다시 확인
      </RowButton>
    );
  }
}
