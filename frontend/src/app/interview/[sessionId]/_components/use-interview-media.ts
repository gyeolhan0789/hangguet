"use client";

import { useEffect, useRef, useState } from "react";

import { useMicLevel } from "@/components/use-mic-level";

// S06 화상 면접의 내 카메라 · 마이크. 서버를 부르지 않는다.
// 기준: 기획 메모 S06(18:757: 내 카메라(WebRTC)는 우측 상단 작게) · 모션 메모 S06(18:2569: 파형은 실제 볼륨 연동)
// · 기획 메모 S06-F(18:3575: 마이크 입력이 10초 이상 0이면 하단 토스트) · MDN getUserMedia
// · 사용자 결정(2026-11-09: 마이크를 껐다 켜면(장치를 빼거나 꺼서 트랙이 끝나면) 다시 연결될 때 자동으로 새로 받는다)
// · MDN MediaStreamTrack ended 이벤트(장치가 사라지면 트랙이 끝나고 다시 살아나지 않는다) · MediaDevices devicechange 이벤트

/** 마이크가 끊긴 동안 다시 받아 보는 간격 */
export const MIC_RETRY_MS = 2000;

/**
 * 화면에 들어오면 카메라 · 마이크를 켜고, 떠나면 끈다. 받지 못하면(새로고침 뒤 권한 거부 · 다른 탭이 장치를 씀 등)
 * stream은 null로 두고 unavailable을 켠 채, 받을 때까지 MIC_RETRY_MS마다 · 장치가 바뀔 때마다 둘 다 다시 받는다.
 * 마이크가 끊기면(트랙이 끝남 · 소리를 받지 못함) 마이크만 새로 받아 카메라 트랙과 묶은 새 stream으로 바꾼다.
 * 바로 한 번 받아 보고, 받을 때까지 MIC_RETRY_MS마다 · 장치가 바뀔 때마다(devicechange) 다시 받아 본다.
 * 운영체제 기본 마이크가 바뀌면(장치를 다시 켬 · 꽂음) 그 장치로 옮긴다.
 */
export function useInterviewMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const level = useMicLevel(stream);
  /** 지금 쓰는 stream. 화면을 떠날 때 새로 받은 마이크까지 끈다 */
  const latest = useRef<MediaStream | null>(null);

  // 처음 받기에 실패했는지(권한 거부 · 다른 탭이 장치를 씀 등). 받으면 false로 돌아온다
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!devices) {
      // 카메라를 지원하지 않는 브라우저(보안 연결이 아님 등). 그리는 중에 상태를 바꾸지 않도록 다음 차례에 알린다
      queueMicrotask(() => setUnavailable(true));
      return;
    }
    let alive = true;
    let requesting = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    const stopRetry = () => {
      clearInterval(retry);
      retry = undefined;
      devices.removeEventListener?.("devicechange", acquire);
    };
    /** 카메라 · 마이크를 함께 받는다. 실패하면 받을 때까지 MIC_RETRY_MS마다 · 장치가 바뀔 때마다 다시 받는다 */
    function acquire() {
      if (requesting) return;
      requesting = true;
      devices
        .getUserMedia({ video: true, audio: true })
        .then((next) => {
          requesting = false;
          if (!alive) {
            next.getTracks().forEach((track) => track.stop());
            return;
          }
          stopRetry();
          latest.current = next;
          setStream(next);
          setUnavailable(false);
        })
        .catch(() => {
          requesting = false;
          if (!alive) return;
          setUnavailable(true);
          if (retry === undefined) {
            retry = setInterval(acquire, MIC_RETRY_MS);
            devices.addEventListener?.("devicechange", acquire);
          }
        });
    }
    acquire();
    return () => {
      alive = false;
      stopRetry();
      latest.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const microphone = stream?.getAudioTracks()[0] ?? null;
  useEffect(() => {
    const devices = navigator.mediaDevices;
    if (!stream || !microphone || !devices) return;
    let alive = true;
    let requesting = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    /**
     * 마이크가 끊겼다: 트랙이 끝났거나(장치를 빼거나 꺼서 다시 살아나지 않는다) 소리를 받지 못하는 중이다
     * (muted: 운영체제 개인 정보 설정에서 마이크 접근을 끄는 등. 다시 켜도 장치 목록은 그대로라 devicechange가 오지 않을 수 있다)
     */
    const lost = () => microphone.readyState === "ended" || microphone.muted;
    const stopRetry = () => {
      clearInterval(retry);
      retry = undefined;
    };
    /** 마이크만 새로 받아(운영체제 기본 마이크) 카메라 트랙과 묶은 새 stream으로 바꾼다 */
    const reacquire = () => {
      if (requesting) return;
      requesting = true;
      devices
        .getUserMedia({ audio: true })
        .then((next) => {
          requesting = false;
          const [audio] = next.getAudioTracks();
          // 새로 받은 마이크도 소리를 받지 못하면(아직 막혀 있음) 바꾸지 않고 다음 시도를 기다린다
          if (!alive || !audio || audio.muted) {
            next.getTracks().forEach((track) => track.stop());
            return;
          }
          stopRetry();
          const replaced = new MediaStream([...stream.getVideoTracks(), audio]);
          latest.current = replaced;
          setStream(replaced);
          // 지난 마이크는 놓는다(면접방은 새 트랙으로 바꿔 보낸다)
          microphone.stop();
        })
        .catch(() => {
          // 아직 장치가 없거나 접근이 막혀 있으면 다음 시도(간격 · devicechange)를 기다린다.
          requesting = false;
        });
    };
    /** 끊겼으면 바로 한 번 받아 보고, 받을 때까지 간격을 두고 다시 받아 본다. 다시 소리가 들어오면 멈춘다 */
    const check = () => {
      if (!lost()) {
        stopRetry();
        return;
      }
      reacquire();
      retry ??= setInterval(() => (lost() ? reacquire() : stopRetry()), MIC_RETRY_MS);
    };
    /**
     * 장치가 바뀌면(꽂음 · 뺌 · 켬 · 끔): 끊겼으면 다시 받고, 살아 있어도 운영체제 기본 마이크가 바뀌었으면 그 장치로 옮긴다
     * (끄는 동안 다른 장치(웹캠 마이크 등)로 받아 둔 경우, 원래 마이크를 다시 켜면 돌아온다)
     */
    const deviceChanged = () => {
      if (lost()) {
        check();
        return;
      }
      void devices
        .enumerateDevices?.()
        .then((list) => {
          const preferred = list.find(
            (device) => device.kind === "audioinput" && device.deviceId === "default",
          );
          const current = microphone.getSettings?.().groupId;
          if (alive && preferred?.groupId && current && preferred.groupId !== current) {
            reacquire();
          }
        })
        .catch(() => {});
    };
    microphone.addEventListener("ended", check);
    microphone.addEventListener("mute", check);
    microphone.addEventListener("unmute", check);
    devices.addEventListener?.("devicechange", deviceChanged);
    check();
    return () => {
      alive = false;
      stopRetry();
      microphone.removeEventListener("ended", check);
      microphone.removeEventListener("mute", check);
      microphone.removeEventListener("unmute", check);
      devices.removeEventListener?.("devicechange", deviceChanged);
    };
  }, [stream, microphone]);

  return { stream, level, unavailable };
}
