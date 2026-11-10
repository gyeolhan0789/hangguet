"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useLayoutEffect, useState, type RefObject } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { Spinner } from "@/components/spinner";
import { formatElapsed } from "@/lib/interview/questions";
import { NO_ANSWER } from "@/lib/result/format";
import type { ReplayItem } from "@/types/api";

// 기준: Figma S07-1 Video(18:4508: 둥글기 20 · 아래 Fade 152(rgba(11,13,20) 0→.8)
// · Question Overlay 왼쪽 24 · rgba(14,16,22,.7) · 둥글기 12 · 좌우 14 · 위아래 10 · 간격 8 · 'Q3' 13 ExtraBold brand · 질문 14 SemiBold 흰색)
// · Player Bar(18:4514: bg-sub · 높이 56 · 둥글기 16 · 좌우 16 · 간격 14 · 재생 36 원 brand-strong · 아이콘 16
// · Timeline 560 × 24(트랙 6 line · 재생한 곳 brand · 마커 지난 질문 brand + line 테두리 2 · 지금 질문 흰색 + brand-strong 테두리 3
// · 앞 질문 흰색 + line 테두리 2) · '06:12 / 18:00' 13 SemiBold text-2 · 배속 칩 surface · 좌우 10 · 위아래 4 · 12 Bold text-2)
// · Transcript(18:4530: bg-sub · 둥글기 16 · 좌우 18 · 위아래 14 · 간격 4 · '자막 · 06:12' 12 Bold text-3 · 답변 15 Medium text-1)
// · 모션 메모 S07-1(18:4573: 타임라인 마커 scale 팝, 재생 중 질문이 바뀌면 영상 좌하단 질문 오버레이 crossfade)
// · 웹 Swagger 6.4(화상은 녹화 영상과 질문별 시점) · 재생 중 자막은 재생 위치가 속한 질문의 answer · ReplayResponse.videoUrl
// · 사용자 결정(2026-10-22: 내 화면(PiP)은 녹화 영상에 합쳐져 있다고 보고 따로 그리지 않는다, 배속 1x → 1.5x → 2x → 1x,
//   자막은 단어 하이라이트 없이 답변 단위)
// · Next.js 16 Preserving UI State(다른 화면으로 가면 이 화면을 없애지 않고 숨기는데, 숨겨도 <video>는 계속 재생되므로 직접 멈춘다)
// · 사용자 결정(2026-11-05: 받는 중이라 재생이 멈췄으면(버퍼링) 멈춘 것과 구분되게 영상 가운데에 로딩을 보인다. Figma에 없어
//   같은 화면 녹화 처리 중 안내(video-pending)의 스피너를 쓰고, 잠깐 끊기는 정도에는 깜빡이지 않게 조금 늦게 보인다)

/** 배속 칩을 누를 때마다 바뀌는 순서 */
export const PLAYBACK_RATES: readonly number[] = [1, 1.5, 2];

/** 타임라인의 질문 점: 지금 질문 · 지나간 질문 · 아직 오지 않은 질문 */
type MarkerState = "current" | "past" | "upcoming";

const MARKER_CLASS: Record<MarkerState, string> = {
  current: "border-[3px] border-brand-strong bg-white",
  past: "border-2 border-line bg-brand",
  upcoming: "border-2 border-line bg-white",
};

function markerState(isCurrent: boolean, offset: number, time: number): MarkerState {
  if (isCurrent) return "current";
  return offset <= time ? "past" : "upcoming";
}

export interface PlayerState {
  /** 재생 위치(초) */
  time: number;
  /** 영상 길이(초). 아직 모르면 0 */
  duration: number;
  playing: boolean;
  rate: number;
}

/** 녹화 영상과 지금 질문 오버레이 */
export function VideoScreen({
  videoUrl,
  video,
  item,
  onTime,
  onDuration,
  onPlaying,
  onRate,
}: Readonly<{
  videoUrl: string;
  video: RefObject<HTMLVideoElement | null>;
  /** 재생 위치가 속한 질문. 첫 질문 전이면 null */
  item: ReplayItem | null;
  onTime: (time: number) => void;
  onDuration: (duration: number) => void;
  onPlaying: (playing: boolean) => void;
  onRate: (rate: number) => void;
}>) {
  const reduce = useReducedMotion();

  // 화면이 이벤트를 듣기 전(하이드레이션 전)에 영상 정보를 이미 받았으면 loadedmetadata를 놓치므로, 처음에 한 번 읽어 둔다.
  const readLoaded = useEffectEvent(() => {
    const element = video.current;
    if (element && element.readyState >= HTMLMediaElement.HAVE_METADATA)
      onDuration(element.duration);
  });
  useEffect(() => readLoaded(), []);

  // 재생하려는데 데이터를 기다리는 중(waiting)이면 true. 다시 재생되거나 멈추거나 옮긴 위치를 받으면 false
  const [buffering, setBuffering] = useState(false);
  const settle = () => setBuffering(false);

  // 다른 화면으로 가 이 화면이 숨겨지면 영상을 멈춘다(돌아오면 멈춘 위치에 그대로 있다).
  useLayoutEffect(() => {
    const element = video.current;
    return () => element?.pause();
  }, [video]);

  return (
    <div className="relative aspect-[860/452] w-full overflow-hidden rounded-[20px] bg-night">
      <video
        ref={video}
        src={videoUrl}
        aria-label="녹화 영상"
        playsInline
        preload="metadata"
        className="size-full object-cover"
        onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => onDuration(event.currentTarget.duration)}
        onDurationChange={(event) => onDuration(event.currentTarget.duration)}
        onPlay={() => onPlaying(true)}
        onPause={() => {
          settle();
          onPlaying(false);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={settle}
        onCanPlay={settle}
        onSeeked={settle}
        onRateChange={(event) => onRate(event.currentTarget.playbackRate)}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[33.6%] bg-gradient-to-b from-[rgba(11,13,20,0)] to-[rgba(11,13,20,0.8)]" />
      <AnimatePresence>
        {buffering && (
          <motion.div
            role="status"
            aria-label="영상을 불러오는 중"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.3, duration: reduce ? 0 : 0.2 } }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.15 } }}
          >
            <Spinner size={28} className="bg-white/70" />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {item && (
          <motion.p
            key={item.questionId}
            className="absolute bottom-[39px] left-6 flex max-w-[calc(100%-48px)] items-center gap-2 rounded-xl bg-[rgba(14,16,22,0.7)] px-3.5 py-2.5 leading-normal tracking-[-0.2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.3 }}
          >
            <span className="shrink-0 text-[13px] leading-normal font-extrabold text-brand">
              Q{item.seq}
            </span>
            <span className="truncate text-sm leading-normal font-semibold text-white">
              {item.question}
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 재생 막대(재생 · 타임라인 · 시간 · 배속)와 자막 */
export function PlayerControls({
  state,
  items,
  offsets,
  current,
  onSeek,
  onTogglePlay,
  onNextRate,
}: Readonly<{
  state: PlayerState;
  items: ReplayItem[];
  /** 질문마다 영상 속 위치(초) */
  offsets: number[];
  /** 재생 위치가 속한 질문의 순번. 첫 질문 전이면 -1 */
  current: number;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onNextRate: () => void;
}>) {
  const reduce = useReducedMotion();
  const item = current >= 0 ? items[current] : null;
  const ratio = (time: number) => (state.duration > 0 ? Math.min(1, time / state.duration) : 0);

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex h-14 w-full items-center gap-3.5 rounded-2xl bg-bg-sub px-4">
        <button
          type="button"
          aria-label={state.playing ? "일시정지" : "재생"}
          onClick={onTogglePlay}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-brand-strong"
        >
          <MaskIcon
            src={state.playing ? "/result/icon-pause.svg" : "/result/icon-play.svg"}
            size={16}
            className="bg-white"
          />
        </button>

        <div className="relative h-6 min-w-0 flex-1 sm:max-w-[560px]">
          <span className="absolute inset-x-0 top-[9px] h-1.5 rounded-full bg-line" />
          <span
            className="absolute top-[9px] left-0 h-1.5 rounded-full bg-brand"
            style={{ width: `${ratio(state.time) * 100}%` }}
          />
          {state.duration > 0 &&
            offsets.map((offset, i) => {
              const marker = markerState(i === current, offset, state.time);
              return (
                // 지금 질문이 되면 새로 그려 한 번 팝 한다(1.4 → 1).
                <motion.span
                  key={`${items[i].questionId}-${i === current}`}
                  aria-hidden
                  data-marker={marker}
                  className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${MARKER_CLASS[marker]}`}
                  style={{ left: `${ratio(offset) * 100}%` }}
                  initial={i === current && !reduce ? { scale: 1.4 } : false}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              );
            })}
          <input
            type="range"
            aria-label="재생 위치"
            aria-valuetext={formatElapsed(state.time)}
            min={0}
            max={state.duration || 0}
            step={0.1}
            value={Math.min(state.time, state.duration || 0)}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </div>

        <p className="shrink-0 text-[13px] leading-normal font-semibold tracking-[-0.2px] text-text-2">
          {formatElapsed(state.time)} / {formatElapsed(state.duration)}
        </p>
        <button
          type="button"
          aria-label={`재생 속도 ${state.rate}x`}
          onClick={onNextRate}
          className="shrink-0 cursor-pointer rounded-full bg-surface px-2.5 py-1 text-xs leading-normal font-bold tracking-[-0.2px] text-text-2"
        >
          {state.rate}x
        </button>
      </div>

      {item && (
        <section
          aria-label="자막"
          // 모바일(sm 미만)은 자막을 빼고 질문 목록(펼치면 답변)으로 본다(사용자 결정 2026-10-26)
          className="flex w-full max-sm:hidden flex-col gap-1 rounded-2xl bg-bg-sub px-[18px] py-3.5 tracking-[-0.2px]"
        >
          <p className="text-xs leading-normal font-bold text-text-3">
            자막 · {formatElapsed(offsets[current])}
          </p>
          <p
            className={`text-[15px] leading-normal font-medium break-keep ${
              item.answer ? "text-text-1" : "text-text-3"
            }`}
          >
            {item.answer ?? NO_ANSWER}
          </p>
        </section>
      )}
    </div>
  );
}
