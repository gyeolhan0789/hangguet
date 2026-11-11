"use client";

import { useState } from "react";

import { tierOf } from "@/lib/streak";

import { LevelUp } from "./level-up";
import { StreakIntro, type IntroCopy } from "./streak-intro";

/** 면접을 마쳐 스트릭이 오른 순간의 문구 (S02-1 기획 메모: 완료 'N일째 달성!') */
export function celebrationCopy(days: number): IntroCopy {
  return { count: days, text: "일째 달성!", sub: "오늘도 해냈어요 — 내일 또 만나요" };
}

/**
 * 면접을 마치고 스트릭이 오른 순간: 'N일째 달성!' 불 전환 → (단계가 올랐으면) S02-L 레벨업.
 * 홈에 들어올 때는 쓰지 않는다. 면접을 마친 화면(S08 흐름)이 한 번만 띄우고, 끝나면 onDone으로 다음 화면으로 보낸다.
 * leveledUp은 면접 끝내기(5.8) 응답의 값을 화면이 기억해 두었다가(interview-store) 넘긴다.
 */
export function StreakCelebration({
  days,
  leveledUp,
  onDone,
}: Readonly<{
  days: number;
  leveledUp: boolean;
  onDone?: () => void;
}>) {
  const [phase, setPhase] = useState<"intro" | "levelUp" | "done">("intro");

  if (phase === "done") return null;

  // 레벨업은 화면 전체를 자기 배경으로 바로 덮으므로, 그때 불 전환을 내려도 비어 보이는 순간이 없다.
  // 불 전환을 남겨 두면 레벨업이 사라지는 동안 뒤에 단계 색이 비쳤다가 한 번에 꺼진다.
  if (phase === "levelUp") {
    return (
      <LevelUp
        days={days}
        onContinue={() => {
          setPhase("done");
          onDone?.();
        }}
      />
    );
  }

  return (
    <StreakIntro
      tier={tierOf(days)}
      copy={celebrationCopy(days)}
      stayCovered={leveledUp}
      onDone={() => {
        if (leveledUp) {
          setPhase("levelUp");
        } else {
          setPhase("done");
          onDone?.();
        }
      }}
    />
  );
}
