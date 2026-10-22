"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useMediaQuery } from "@/components/use-media-query";
import { PERSONAS } from "@/lib/interview/personas";
import { itemIndexAt, monthDayKst, questionOffset } from "@/lib/result/format";
import { resultPath } from "@/lib/routes";
import type { ReplayResponse } from "@/types/api";

import { ReplayQuestions } from "./replay-questions";
import { PLAYBACK_RATES, PlayerControls, VideoScreen, type PlayerState } from "./video-player";

// 기준: Figma S07-1 면접 다시보기(18:4478: Body 좌우 80 · 위 24 · 간격 20, Head — '‹ 결과로' 14 SemiBold text-3 · chevron-left 16
// · '면접 다시보기' 30 ExtraBold 행간 1.3 · 오른쪽 메타 14 SemiBold text-3, Main — 플레이어 860 · 간격 24 · 질문 목록 396)
// · Swagger 6.4 ReplayResponse(persona · companyName · jobTitle · startedAt(상단 날짜) · videoUrl · items)
// · ReplayItem.questionCreatedAt(startedAt과의 차이(초)가 영상 속 질문 위치) · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당
// 질문 시점으로 점프, 재생 중인 질문이 오른쪽 목록에서 강조 + 자막 동기화)
// · 사용자 결정(2026-10-22: 영상이 없으면(채팅 · videoUrl null) 플레이어 없이 질문 목록과 답변 탭만 보여 준다,
//   질문 목록은 맨 위 카드부터 자막 상자 맨 아래까지의 높이에 맞추고 넘치면 스크롤)

/** S07-1 면접 다시보기 화면 */
export function ReplayView({ replay }: { replay: ReplayResponse }) {
  const persona = PERSONAS.find((info) => info.persona === replay.persona);
  const offsets = replay.items.map((item) => questionOffset(replay.startedAt, item));
  const video = useRef<HTMLVideoElement>(null);
  const [player, setPlayer] = useState<PlayerState>({
    time: 0,
    duration: 0,
    playing: false,
    rate: 1,
  });
  // 펼친 질문(눌러서 연다). 없으면 -1
  const [opened, setOpened] = useState(-1);
  const hasVideo = replay.videoUrl !== null;
  // 재생 위치가 속한 질문(영상이 있을 때). 첫 질문 전이면 -1
  const current = hasVideo ? itemIndexAt(offsets, player.time) : -1;
  // 넓은 화면에서 영상 옆에 놓일 때만 질문 목록 높이를 왼쪽 열(자막 상자 끝까지)에 맞춘다(lg = Tailwind 1024px).
  const fill = useMediaQuery("(min-width: 1024px)") && hasVideo;

  function seek(time: number) {
    if (video.current) video.current.currentTime = time;
    setPlayer((state) => ({ ...state, time }));
  }

  function togglePlay() {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  }

  // 배속 칩: 1x → 1.5x → 2x → 1x
  function nextRate() {
    const element = video.current;
    if (!element) return;
    const index = PLAYBACK_RATES.findIndex((rate) => rate === element.playbackRate);
    element.playbackRate = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
  }

  // 질문 카드를 누르면 펼치고(영상은 그 질문 시점으로), 펼친 카드를 다시 누르면 목록으로 돌아간다.
  function toggle(index: number) {
    if (opened === index) {
      setOpened(-1);
      return;
    }
    setOpened(index);
    if (hasVideo) seek(offsets[index]);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-10 lg:px-20">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <Link
            href={resultPath(replay.id)}
            className="flex w-fit items-center gap-1 text-sm leading-normal font-semibold tracking-[-0.2px] text-text-3"
          >
            <MaskIcon src="/result/icon-chevron-left.svg" size={16} className="bg-text-3" />
            결과로
          </Link>
          <h1 className="text-[30px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
            면접 다시보기
          </h1>
        </div>
        <span className="hidden flex-1 sm:block" />
        <p className="text-sm leading-normal font-semibold tracking-[-0.2px] break-keep text-text-3">
          {persona?.name} · {replay.companyName} {replay.jobTitle} · {monthDayKst(replay.startedAt)}
        </p>
      </div>

      {/* lg: 왼쪽 열은 영상 · 재생 막대 · 자막, 오른쪽 질문 목록은 왼쪽 열(자막 상자 끝까지) 높이에 맞추고 그 높이를 넘지 않는다. */}
      <div
        className={
          hasVideo
            ? "grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_396px]"
            : "flex flex-col"
        }
      >
        {replay.videoUrl !== null && (
          <>
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <VideoScreen
                videoUrl={replay.videoUrl}
                video={video}
                item={current >= 0 ? replay.items[current] : null}
                onTime={(time) => setPlayer((state) => ({ ...state, time }))}
                onDuration={(duration) =>
                  setPlayer((state) => ({
                    ...state,
                    duration: Number.isFinite(duration) ? duration : 0,
                  }))
                }
                onPlaying={(playing) => setPlayer((state) => ({ ...state, playing }))}
                onRate={(rate) => setPlayer((state) => ({ ...state, rate }))}
              />
            </div>
            <div className="min-w-0 lg:col-start-1 lg:row-start-2">
              <PlayerControls
                state={player}
                items={replay.items}
                offsets={offsets}
                current={current}
                onSeek={seek}
                onTogglePlay={togglePlay}
                onNextRate={nextRate}
              />
            </div>
          </>
        )}
        <div
          className={
            hasVideo
              ? "mt-3 min-w-0 lg:relative lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0"
              : "w-full"
          }
        >
          <div className={hasVideo ? "lg:absolute lg:inset-0" : undefined}>
            <ReplayQuestions
              items={replay.items}
              offsets={offsets}
              highlighted={hasVideo ? current : opened}
              opened={opened}
              onToggle={toggle}
              fill={fill}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
