import { useEffect } from "react";

// 오리 면접관 배경음(풀벌레 · 강물 소리). 기준: 사용자 결정(2026-11-04: Let it drift 저장소의 배경음(노래 말고)을 오리 면접 화면에
// 작게 반복 재생, 화면에서만 재생해 녹화 · 다시보기에는 넣지 않는다, 결과 분석으로 넘어가면 천천히 줄이며 멈춤)
// · 출처 public/interview/duck/CREDITS.txt(Freesound EduFigueres, CC BY 4.0)
// · MDN AudioBufferSourceNode.loop(파일을 디코딩해 끊김 없이 반복) · AudioParam.setTargetAtTime(음량을 부드럽게 바꿈)
// · Chrome 자동 재생 정책(사용자 동작 전에 만든 AudioContext는 suspended — 누르거나 키를 누르면 resume)

export const DUCK_AMBIENCE_URL = "/interview/duck/ambience.mp3";
/** 배경음 음량(0~1). 질문 음성 · 감탄 소리를 가리지 않게 작게 둔다 */
export const DUCK_AMBIENCE_VOLUME = 0.25;
/** 켤 때 · 끌 때 음량이 바뀌는 시간 상수(초). 약 3배 시간에 거의 다 바뀐다 */
const FADE_SECONDS = 0.5;

let context: AudioContext | null = null;
let buffer: Promise<AudioBuffer> | null = null;

function audioContext(): AudioContext {
  context ??= new AudioContext();
  return context;
}

function loadBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  buffer ??= fetch(DUCK_AMBIENCE_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`${DUCK_AMBIENCE_URL} ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => ctx.decodeAudioData(data));
  // 받지 못하면 다음에 다시 받는다
  buffer.catch(() => (buffer = null));
  return buffer;
}

/**
 * active인 동안 배경음을 끊김 없이 반복해 튼다. 꺼지거나 화면을 떠나면 천천히 줄이고 멈춘다.
 * 소리를 낼 수 없으면(오디오를 쓸 수 없는 환경 · 파일 오류) 배경음 없이 진행한다.
 */
export function useDuckAmbience(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext;
    try {
      ctx = audioContext();
    } catch {
      return;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    let source: AudioBufferSourceNode | null = null;
    let stopped = false;

    // 사용자 동작 전에는 소리를 낼 수 없어(suspended) 처음 누르거나 키를 누를 때 다시 켠다
    const resume = () => void ctx.resume().catch(() => {});
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    resume();

    loadBuffer(ctx)
      .then((decoded) => {
        if (stopped) return;
        source = ctx.createBufferSource();
        source.buffer = decoded;
        source.loop = true;
        source.connect(gain);
        source.start();
        gain.gain.setTargetAtTime(DUCK_AMBIENCE_VOLUME, ctx.currentTime, FADE_SECONDS);
      })
      .catch(() => {});

    return () => {
      stopped = true;
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.setTargetAtTime(0, now, FADE_SECONDS);
      const playing = source;
      // 다 줄어든 뒤 멈추고 연결을 끊는다
      setTimeout(
        () => {
          try {
            playing?.stop();
          } catch {
            // 이미 멈췄으면 그대로 둔다
          }
          playing?.disconnect();
          gain.disconnect();
        },
        FADE_SECONDS * 4 * 1000,
      );
    };
  }, [active]);
}
