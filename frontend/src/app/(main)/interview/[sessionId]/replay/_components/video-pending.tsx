"use client";

import Image from "next/image";

import { Spinner } from "@/components/spinner";
import type { VideoStatus } from "@/types/api";

// 기준: API 명세 6.4 videoStatus(MERGING이면 플레이어 자리에 녹화를 처리하는 중임을 안내, FAILED면 녹화를 불러오지 못했다고 안내)
// · S15P31A301-259. Figma에 없는 화면이라 플레이어 자리(Video Screen 18:4478: 860:452 · 둥글기 20 · night)를 그대로 쓴다.
// · 사용자 결정(2026-10-27: 합치는 중 문구는 '영상을 업로드하는 중이에요'. 채팅 면접도 같은 자리에 '채팅 면접은 녹화 영상이 없어요'를
//   아이콘 없이 둔다)

/** 플레이어 자리 안내. 영상이 아직 없거나(MERGING) 불러오지 못했거나(FAILED) 채팅 면접이라 영상이 없을 때(NONE) */
export type VideoNotice = Exclude<VideoStatus, "READY"> | "NONE";

/** 녹화 영상 대신 플레이어 자리에 두는 안내 */
export function VideoPending({ status }: { status: VideoNotice }) {
  return (
    <div
      // 채팅은 바뀌지 않는 설명이라 상태 알림(status)으로 읽어 주지 않는다
      role={status === "NONE" ? undefined : "status"}
      className="flex aspect-[860/452] w-full flex-col items-center justify-center gap-3 rounded-[20px] bg-night px-6 text-center"
    >
      {status === "MERGING" && <Spinner size={28} className="bg-white/70" />}
      {status === "FAILED" && (
        <Image src="/interview/icon-circle-alert.svg" alt="" width={28} height={28} />
      )}
      <p className="text-base leading-normal font-bold tracking-[-0.2px] text-white">
        {status === "MERGING"
          ? "영상을 업로드하는 중이에요"
          : status === "FAILED"
            ? "녹화를 불러오지 못했어요"
            : "채팅 면접은 녹화 영상이 없어요"}
      </p>
    </div>
  );
}
