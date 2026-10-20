"use client";

import { useMotionValue, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { mediaFailure, micLevel, type CheckStatus, type DeviceFailure } from "@/lib/devices/media";

// 기준: Figma S05(18:2333) 카메라 · 마이크 · 네트워크 체크 줄과 미리보기 · S05-E(18:4013) 권한 거부
// · 모션 메모 S05(18:2492: 위에서부터 하나씩 확인(stagger 0.25s) · 마이크 레벨은 requestAnimationFrame + Motion value)
// · 기획 메모 S05-E(18:3468: [다시 확인하기] → 권한 재요청)
// 장치 점검은 서버를 부르지 않고 브라우저에서만 한다(getUserMedia · Web Audio · navigator.onLine).

/** 체크 줄이 하나씩 확인되는 간격(모션 메모 stagger 0.25s) */
export const CHECK_STAGGER_MS = 250;

export type NetworkStatus = "checking" | "ok" | "offline";

export interface DeviceCheck {
  /** 카메라 · 마이크 스트림. 받지 못했으면 null */
  stream: MediaStream | null;
  camera: CheckStatus;
  mic: CheckStatus;
  network: NetworkStatus;
  /** 마이크 소리 크기(0~1). 매 프레임 바뀐다 */
  level: MotionValue<number>;
  /** 권한 · 장치를 다시 확인 중(S05-E [다시 확인하기]) */
  rechecking: boolean;
  /** 카메라 · 마이크를 다시 요청한다. 둘 다 받으면 true */
  recheck: () => Promise<boolean>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stopTracks = (stream: MediaStream | null) =>
  stream?.getTracks().forEach((track) => track.stop());

/** 카메라 · 마이크를 한 번에 요청한다. HTTPS가 아니면 mediaDevices가 없어 unsupported가 된다. */
function requestMedia(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new TypeError("getUserMedia를 쓸 수 없어요"));
  }
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

/** S05 장치 점검. 화면에 들어오면 바로 카메라 · 마이크를 요청하고, 화면을 떠나면 장치를 끈다. */
export function useDeviceCheck(): DeviceCheck {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camera, setCamera] = useState<CheckStatus>("checking");
  const [mic, setMic] = useState<CheckStatus>("checking");
  const [network, setNetwork] = useState<NetworkStatus>("checking");
  const [rechecking, setRechecking] = useState(false);
  const level = useMotionValue(0);
  // 요청할 때마다 1씩 늘린다. 늦게 끝난 이전 요청 · 떠난 화면의 결과는 버린다.
  const run = useRef(0);
  const current = useRef<MediaStream | null>(null);
  const networkShown = useRef(false);

  const request = useCallback(async (): Promise<boolean> => {
    const id = ++run.current;
    const alive = () => run.current === id;
    let next: MediaStream | null = null;
    let failure: DeviceFailure | null = null;
    try {
      next = await requestMedia();
    } catch (error) {
      failure = mediaFailure(error);
    }
    if (!alive()) {
      stopTracks(next);
      return false;
    }
    stopTracks(current.current);
    current.current = next;
    setStream(next);

    // 위에서부터 하나씩: 카메라 → 마이크 → (처음 한 번) 네트워크
    setCamera(next?.getVideoTracks().length ? "ok" : (failure ?? "missing"));
    await wait(CHECK_STAGGER_MS);
    if (!alive()) return false;
    setMic(next?.getAudioTracks().length ? "ok" : (failure ?? "missing"));
    if (!networkShown.current) {
      await wait(CHECK_STAGGER_MS);
      if (!alive()) return false;
      networkShown.current = true;
      setNetwork(navigator.onLine ? "ok" : "offline");
    }
    return failure === null;
  }, []);

  const recheck = useCallback(async () => {
    setRechecking(true);
    try {
      return await request();
    } finally {
      setRechecking(false);
    }
  }, [request]);

  // 화면에 들어오면 요청하고, 떠나면 진행 중인 요청을 버리고 장치를 끈다(카메라 켜짐 표시가 남지 않게).
  useEffect(() => {
    void request();
    const runs = run;
    const media = current;
    return () => {
      runs.current++;
      stopTracks(media.current);
      media.current = null;
    };
  }, [request]);

  // 네트워크: 브라우저의 온라인 여부와 그 변화만 본다(navigator.connection은 Chromium에서만 돼서 쓰지 않는다).
  useEffect(() => {
    const update = () => {
      if (networkShown.current) setNetwork(navigator.onLine ? "ok" : "offline");
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // 점검 중 장치를 뽑거나 다른 앱이 가져가면 그 줄을 다시 실패로 바꾼다.
  useEffect(() => {
    if (!stream) return;
    const onVideoEnded = () => setCamera("ended");
    const onAudioEnded = () => setMic("ended");
    const video = stream.getVideoTracks();
    const audio = stream.getAudioTracks();
    video.forEach((track) => track.addEventListener("ended", onVideoEnded));
    audio.forEach((track) => track.addEventListener("ended", onAudioEnded));
    return () => {
      video.forEach((track) => track.removeEventListener("ended", onVideoEnded));
      audio.forEach((track) => track.removeEventListener("ended", onAudioEnded));
    };
  }, [stream]);

  // 마이크 레벨: 매 프레임 입력 파형의 크기를 재서 Motion value에 넣는다(리렌더 없이 막대만 바뀐다).
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    // 사용자 동작 전에 만든 AudioContext는 멈춰 있을 수 있어, 처음 누를 때 다시 깨운다.
    const resume = () => void context.resume();
    resume();
    window.addEventListener("pointerdown", resume, { once: true });
    let frame = requestAnimationFrame(function tick() {
      analyser.getFloatTimeDomainData(samples);
      level.set(micLevel(samples));
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", resume);
      level.set(0);
      void context.close();
    };
  }, [stream, level]);

  return { stream, camera, mic, network, level, rechecking, recheck };
}
