"use client";

import { useEffect, useState } from "react";

import { useMicLevel } from "@/components/use-mic-level";

// S06 화상 면접의 내 카메라 · 마이크. 서버를 부르지 않는다.
// 기준: 기획 메모 S06(18:757: 내 카메라(WebRTC)는 우측 상단 작게) · 모션 메모 S06(18:2569: 파형은 실제 볼륨 연동)
// · 기획 메모 S06-F(18:3575: 마이크 입력이 10초 이상 0이면 하단 토스트) · MDN getUserMedia

/** 화면에 들어오면 카메라 · 마이크를 켜고, 떠나면 끈다. 받지 못하면 stream은 null로 둔다(장치 점검은 S05에서 했다). */
export function useInterviewMedia() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const level = useMicLevel(stream);

  useEffect(() => {
    let alive = true;
    let current: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: true })
      .then((next) => {
        if (!alive) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        current = next;
        setStream(next);
      })
      .catch(() => {
        if (alive) setStream(null);
      });
    return () => {
      alive = false;
      current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { stream, level };
}
