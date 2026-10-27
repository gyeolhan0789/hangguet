"use client";

import { useMotionValue, type MotionValue } from "motion/react";
import { useEffect } from "react";

import { micLevel } from "@/lib/devices/media";

// 마이크 소리 크기를 매 프레임 재는 훅. S05 장치 점검 마이크 레벨과 S06 면접 파형이 같이 쓴다.
// 기준: 모션 메모 S05(18:2492: 마이크 레벨은 requestAnimationFrame + Motion value) · 모션 메모 S06(18:2569: 파형은 실제 볼륨 연동)
// · MDN AnalyserNode.getFloatTimeDomainData

/** stream의 마이크 소리 크기(0~1). 리렌더 없이 매 프레임 바뀌는 Motion value로 준다. 마이크가 없으면 0 */
export function useMicLevel(stream: MediaStream | null): MotionValue<number> {
  const level = useMotionValue(0);

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

  return level;
}
