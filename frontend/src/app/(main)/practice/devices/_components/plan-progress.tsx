"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { Spinner } from "@/components/spinner";
import { useOnline } from "@/components/use-online";
import { retryPlan } from "@/lib/interview/actions";
import type { PreloadStatus } from "@/stores/interviewer-preload-store";
import type { SessionResponse } from "@/types/api";

import { RowButton } from "./check-row";

// 기준: Figma S05 Preparing(18:2472: brand-soft 줄 · loader 18 · '면접관이 질문을 준비하고 있어요' 15 Bold brand-ink
// · 오른쪽 '78%' 14 ExtraBold · 6px 트랙(bg-sub) · 채움 brand-strong) · Swagger 5.2 면접 조회(planStatus · planProgress, 2초마다)
// · 5.3 면접 플랜 재생성 · 기획 메모 S05(18:752: 질문 · 평가 기준 내용은 노출 X, 생성 실패 시 재시도 안내)
// · 모션 메모 S05(18:2492: 진행률 width 애니메이션 + 스피너 회전)
// · 사용자 결정(2026-10-22: 면접관 3D 모델을 다 받을 때까지 이 줄을 띄우고 진행률은 질문 준비 · 모델 받기 중 작은 쪽,
//   실패 문구는 둘 다 '면접 준비에 실패했어요'로 합치고 [다시 시도]는 실패한 쪽만 다시 한다(질문 준비 5.3 · 모델 다시 받기),
//   인터넷이 끊기면 조회를 멈췄다가 다시 연결되면 이어서 한다)

/** 질문 준비를 다시 조회하는 간격(Swagger 5.2 "2초마다(임시 값)") */
export const PLAN_POLL_MS = 2000;

/** 면접관 3D 모델 받기 상태(useInterviewerPreloadStore) */
export interface ModelPreload {
  status: PreloadStatus;
  /** 받은 비율(0~1) */
  progress: number;
}

/**
 * 면접관이 질문을 준비하는 진행률(질문 준비와 모델 받기를 합친 것). 질문 준비 중이면 2초마다 화면을 다시 그려(router.refresh)
 * 서버 컴포넌트가 5.2를 다시 부르게 한다. (API는 서버에서만 부른다 — AGENTS.md)
 */
export function PlanProgress({
  sessionId,
  status,
  progress,
  model,
  onRetryModel,
}: {
  sessionId: SessionResponse["id"];
  status: SessionResponse["planStatus"];
  /** 0~100. GENERATING일 때만 값이 있다 */
  progress: SessionResponse["planProgress"];
  model: ModelPreload;
  /** 모델을 다시 받는다 */
  onRetryModel: () => void;
}) {
  const router = useRouter();
  const online = useOnline();
  const [retrying, startRetry] = useTransition();
  // refresh를 transition으로 감싸 다시 그리기가 끝났는지 안다. 끝난 뒤에 다음 조회를 예약해 요청이 겹치지 않게 한다.
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (status !== "GENERATING" || refreshing || !online) return;
    const timer = setTimeout(() => startRefresh(() => router.refresh()), PLAN_POLL_MS);
    return () => clearTimeout(timer);
  }, [status, refreshing, online, router]);

  const planFailed = status === "FAILED";
  const modelFailed = model.status === "failed";

  // 실패한 쪽만 다시 한다.
  function retry() {
    setError(undefined);
    if (modelFailed) onRetryModel();
    if (!planFailed) return;
    startRetry(async () => {
      const result = await retryPlan(sessionId);
      if (result.formError) setError(result.formError);
    });
  }

  if (planFailed || modelFailed) {
    return (
      <div className="flex w-full flex-col gap-2.5 rounded-2xl bg-danger-soft px-4 py-3.5 dark:bg-danger-soft/14">
        <div className="flex w-full items-center gap-2">
          <MaskIcon src="/devices/icon-circle-x.svg" size={18} className="bg-danger" />
          <p className="min-w-0 flex-1 text-[15px] leading-normal font-bold tracking-[-0.2px] text-danger">
            면접 준비에 실패했어요
          </p>
          <RowButton icon="/devices/icon-rotate-cw.svg" onClick={retry} pending={retrying}>
            다시 시도
          </RowButton>
        </div>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              key={error}
              role="alert"
              className="text-sm leading-normal font-semibold text-danger"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const modelReady = model.status === "ready";
  const ready = status === "READY" && modelReady;
  const planPercent = status === "READY" ? 100 : Math.min(100, Math.max(0, progress ?? 0));
  const modelPercent = modelReady ? 100 : Math.min(100, Math.floor(model.progress * 100));
  const percent = Math.min(planPercent, modelPercent);
  return (
    <div className="flex w-full flex-col gap-2.5 rounded-2xl bg-brand-soft px-4 py-3.5 dark:bg-brand-soft/8">
      <div className="flex w-full items-center gap-2 leading-normal tracking-[-0.2px] text-brand-ink">
        {ready ? (
          <MaskIcon src="/devices/icon-circle-check.svg" size={18} className="bg-brand-ink" />
        ) : (
          <Spinner size={18} className="bg-brand-ink" />
        )}
        <p className="min-w-0 flex-1 text-[15px] font-bold">
          {ready ? "면접관이 질문을 준비했어요" : "면접관이 질문을 준비하고 있어요"}
        </p>
        <p className="shrink-0 text-sm leading-normal font-extrabold">{percent}%</p>
      </div>
      <div
        role="progressbar"
        aria-label="질문 준비"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-full overflow-hidden rounded-full bg-bg-sub"
      >
        <motion.div
          className="h-full rounded-full bg-brand-strong"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
