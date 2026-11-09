"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { useMediaQuery } from "@/components/use-media-query";
import { useOnline } from "@/components/use-online";
import { PERSONAS } from "@/lib/interview/personas";
import { itemIndexAt, monthDayKst, questionOffset } from "@/lib/result/format";
import { timelineSeries } from "@/lib/result/timeline";
import { resultPath } from "@/lib/routes";
import type { ReplayResponse } from "@/types/api";

import { ReplayQuestions } from "./replay-questions";
import { ReplayTimeline } from "./replay-timeline";
import { VideoPending, type VideoNotice } from "./video-pending";
import { PLAYBACK_RATES, PlayerControls, VideoScreen, type PlayerState } from "./video-player";

// 기준: Figma S07-1 면접 다시보기(18:4478: Body 좌우 80 · 위 24 · 간격 20, Head — '‹ 결과로' 14 SemiBold text-3 · chevron-left 16
// · '면접 다시보기' 30 ExtraBold 행간 1.3 · 오른쪽 메타 14 SemiBold text-3, Main — 플레이어 860 · 간격 24 · 질문 목록 396)
// · Swagger 6.4 ReplayResponse(persona · companyName · jobTitle · startedAt(상단 날짜) · videoUrl · items)
// · ReplayItem.questionCreatedAt(recordingStartedAt(null이면 startedAt)과의 차이(초)가 영상 속 질문 위치) · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당
// 질문 시점으로 점프, 재생 중인 질문이 오른쪽 목록에서 강조 + 자막 동기화)
// · 사용자 결정(2026-10-22: 질문 목록은 맨 위 카드부터 자막 상자 맨 아래까지의 높이에 맞추고 넘치면 스크롤)
// · 사용자 결정(2026-10-26, 모바일(sm 미만)): 영상 아래 자막 상자는 빼고 질문 목록(펼치면 답변)으로 본다.
//   화면 높이를 헤더 아래에 맞춰 영상 · 재생 막대는 위에 고정하고 질문 목록만 스크롤한다.
// · 사용자 결정(2026-10-27: 채팅 면접도 영상 자리를 두고 '채팅 면접은 녹화 영상이 없어요'를 보여 준다. 모바일 배치도 화상과 같다)
// · API 명세 6.4 videoStatus(READY일 때만 videoUrl. MERGING이면 플레이어 자리에 처리 중 안내 + 10초마다(임시 값) 6.4 다시 조회,
//   FAILED면 불러오지 못했다고 안내. 두 경우 모두 질문 목록과 답변은 보여 준다) · S15P31A301-259
// · 사용자 결정(2026-11-05: S07 [자세히 보기](q = 질문 순서)로 들어오면 그 질문을 펼치고 영상도 그 질문 시점에서 시작한다)

/** 녹화를 합치는 중(MERGING)일 때 6.4를 다시 조회하는 간격(API 명세 6.4 임시 값) */
export const REPLAY_POLL_MS = 10_000;

/**
 * S07-1 면접 다시보기 화면. 한 번 본 화면은 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 새로 들어올 때마다(push · replace)
 * 새로 그려 주소의 질문(q)을 펼친다. 뒤로 · 앞으로 가기로 돌아오면 펼친 질문 · 재생 위치를 그대로 둔다(Next useRouter().bfcacheId).
 */
export function ReplayView({ replay }: { replay: ReplayResponse }) {
  const { bfcacheId } = useRouter();
  const seq = Number(useSearchParams().get("q"));
  const initial = replay.items.findIndex((item) => item.seq === seq);
  return <Replay key={bfcacheId} replay={replay} initial={initial} />;
}

/** @param initial 처음에 펼칠 질문. 없으면 -1 */
function Replay({ replay, initial }: { replay: ReplayResponse; initial: number }) {
  const persona = PERSONAS.find((info) => info.persona === replay.persona);
  // 영상 0초 기준. 녹화 시작 시각이 없으면(채팅 · 이전 면접) 면접 시작 시각을 쓴다(API 명세 6.4)
  const recordingStart = replay.recordingStartedAt ?? replay.startedAt;
  const offsets = replay.items.map((item) => questionOffset(recordingStart, item));
  const video = useRef<HTMLVideoElement>(null);
  // 처음에 펼친 질문이 있으면 영상도 그 질문 시점에서 시작한다
  const startTime = initial >= 0 && replay.videoUrl !== null ? offsets[initial] : 0;
  const [player, setPlayer] = useState<PlayerState>({
    time: startTime,
    duration: 0,
    playing: false,
    rate: 1,
  });
  // 펼친 질문(눌러서 연다). 없으면 -1
  const [opened, setOpened] = useState(initial);
  // 영상 자리는 화상 · 채팅 모두 둔다. 재생은 영상이 준비됐을 때(READY · videoUrl)만 하고, 그 밖에는 자리에 안내를 둔다.
  const hasVideo = replay.videoUrl !== null;
  const pendingStatus: VideoNotice | null =
    replay.videoStatus === "MERGING" || replay.videoStatus === "FAILED"
      ? replay.videoStatus
      : replay.videoStatus === null
        ? "NONE"
        : null;
  // 녹화를 합치는 중이면 10초마다 다시 그려 6.4를 다시 받는다(다시 그리기가 끝난 뒤 다음 조회를 예약한다).
  // 인터넷이 끊기면 멈췄다가 다시 연결되면 이어서 한다.
  const router = useRouter();
  const online = useOnline();
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    if (replay.videoStatus !== "MERGING" || refreshing || !online) return;
    const timer = setTimeout(() => startRefresh(() => router.refresh()), REPLAY_POLL_MS);
    return () => clearTimeout(timer);
  }, [replay.videoStatus, refreshing, online, router]);
  // 재생 위치가 속한 질문(영상이 있을 때). 첫 질문 전이면 -1
  const current = hasVideo ? itemIndexAt(offsets, player.time) : -1;
  // 넓은 화면에서 영상 자리(영상 또는 녹화 안내) 옆에 놓일 때만 질문 목록 높이를 왼쪽 열 끝까지에 맞춘다(lg = Tailwind 1024px).
  const fill = useMediaQuery("(min-width: 1024px)");
  // 다시보기 타임라인(Swagger 6.4 items[].timeline). 타임라인이 있는 답변이 없으면 그리지 않는다
  const timeline = timelineSeries(replay.items, player.duration);
  const showTimeline = hasVideo && timeline !== null && player.duration > 0;

  function seek(time: number) {
    if (video.current) video.current.currentTime = time;
    setPlayer((state) => ({ ...state, time }));
  }

  // 영상 정보를 받기 전에 위치를 정해도 받은 뒤 그 위치에서 시작한다(HTML 표준 default playback start position)
  const seekStart = useEffectEvent(() => {
    if (startTime > 0 && video.current) video.current.currentTime = startTime;
  });
  useEffect(() => seekStart(), []);

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
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 pt-6 pb-10 max-sm:h-[calc(100svh-72px)] max-sm:pb-4 lg:px-20">
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

      {/* lg: 왼쪽 열은 영상 · 재생 막대 · 자막(녹화가 없으면 녹화 안내), 오른쪽 질문 목록은 왼쪽 열 높이에 맞추고 그 높이를 넘지 않는다. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col lg:grid-cols-[minmax(0,1fr)_396px]">
        {pendingStatus && (
          <div className="min-w-0 shrink-0 lg:col-start-1 lg:row-start-1">
            <VideoPending status={pendingStatus} />
          </div>
        )}
        {replay.videoUrl !== null && (
          <>
            <div className="min-w-0 shrink-0 lg:col-start-1 lg:row-start-1">
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
            <div className="min-w-0 shrink-0 lg:col-start-1 lg:row-start-2">
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
            {showTimeline && (
              <div className="min-w-0 shrink-0 lg:col-start-1 lg:row-start-3">
                <ReplayTimeline
                  points={timeline.points}
                  checkpoints={timeline.checkpoints}
                  duration={player.duration}
                  offsets={offsets}
                  time={player.time}
                  onSeek={seek}
                />
              </div>
            )}
          </>
        )}
        <div
          data-testid="replay-questions-scroll"
          className={`mt-3 min-w-0 max-sm:mt-0 max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto max-sm:overscroll-contain lg:relative lg:col-start-2 lg:row-start-1 lg:mt-0 ${
            // 답변 흐름도 왼쪽 열에 두므로 질문 목록 높이를 그 끝까지 맞춘다
            showTimeline ? "lg:row-span-3" : "lg:row-span-2"
          }`}
        >
          <div className="lg:absolute lg:inset-0">
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
