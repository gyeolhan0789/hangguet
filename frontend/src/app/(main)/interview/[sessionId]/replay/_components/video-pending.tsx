"use client";

import Image from "next/image";

import { Spinner } from "@/components/spinner";
import type { VideoStatus } from "@/types/api";

// 기준: API 명세 6.4 videoStatus(MERGING이면 플레이어 자리에 녹화를 처리하는 중임을 안내, FAILED면 녹화를 불러오지 못했다고 안내)
// · S15P31A301-259. Figma에 없는 화면이라 플레이어 자리(Video Screen 18:4478: 860:452 · 둥글기 20 · night)를 그대로 쓴다.

/** 녹화 영상이 아직 없거나(MERGING) 불러오지 못했을 때(FAILED) 플레이어 자리에 두는 안내 */
export function VideoPending({ status }: { status: Exclude<VideoStatus, "READY"> }) {
  const merging = status === "MERGING";
  return (
    <div
      role="status"
      className="flex aspect-[860/452] w-full flex-col items-center justify-center gap-3 rounded-[20px] bg-night px-6 text-center"
    >
      {merging ? (
        <Spinner size={28} className="bg-white/70" />
      ) : (
        <Image src="/interview/icon-circle-alert.svg" alt="" width={28} height={28} />
      )}
      <p className="text-base leading-normal font-bold tracking-[-0.2px] text-white">
        {merging ? "녹화를 처리하는 중이에요" : "녹화를 불러오지 못했어요"}
      </p>
    </div>
  );
}
