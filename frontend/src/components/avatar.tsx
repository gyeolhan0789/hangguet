"use client";

import { AnimatePresence, motion } from "motion/react";

import { MaskIcon } from "./mask-icon";

// 기준: Figma C/App Header Avatar(17:49: 36 · user 20) · C01 드롭다운(40 · user-round 20) · S09 Avatar(18:2869: 104 · user-round 52)
// · S09-1 Avatar(18:3187: 56 · user-round 28) — 회색(surface) 원 안에 사람 아이콘(text-3). 사진(2.1 profileImageUrl)이 있으면 위에 덮는다.
// · 모션 메모 S09-1(18:3261: 프로필 사진 변경 → 아바타 crossfade)

/** 프로필 사진. 사진이 없거나 못 불러오면 아래 깔린 사람 아이콘이 보인다. 사진이 바뀌면 crossfade */
export function Avatar({
  imageUrl,
  size,
  icon,
  iconSize,
}: Readonly<{
  imageUrl: string | null;
  size: number;
  /** 사진이 없을 때 아이콘(Figma 자리마다 다르다) */
  icon: string;
  iconSize: number;
}>) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface"
      style={{ width: size, height: size }}
    >
      <MaskIcon src={icon} size={iconSize} className="bg-text-3" />
      <AnimatePresence initial={false}>
        {imageUrl && (
          <motion.span
            key={imageUrl}
            aria-hidden
            data-testid="avatar-image"
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url("${imageUrl}")` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}
