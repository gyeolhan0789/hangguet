"use client";

import { motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { AttitudeSample } from "@/lib/interview/room-messages";
import { useInterviewStore } from "@/stores/interview-store";

// 기준: Figma 면접 태도 타일(531:2386 S06 측정 중 · 531:2475 상태 모음: 측정 중 · 얼굴 확인 중 · 대기 · 접힘
// · 536:2358 / 536:2396 모바일 접힘 · 펼침) · AI 명세 6.3 interview.attitude(0~100, 얼굴을 확인할 수 없으면 null)
// · 사용자 결정(2026-11-12: 내 카메라 아래 · 숫자 하나와 선 하나 · 설명 문구 없음 · 최근 30초)

/** 대기: 답할 차례가 아니다 · 측정 중: 마지막 점수가 있다 · 얼굴 확인 중: 답하는 중인데 마지막 점수가 없다(null) */
type AttitudeStatus = "idle" | "measuring" | "checking";

const STATUS_LABEL: Record<AttitudeStatus, string> = {
  idle: "대기",
  measuring: "측정 중",
  checking: "얼굴 확인 중",
};

/** 받은 점수와 답하는 중인지로 타일 상태와 보여 줄 점수(마지막으로 받은 숫자)를 정한다 */
export function attitudeView(samples: readonly AttitudeSample[], answering: boolean) {
  const last = samples.at(-1);
  const latest = samples.findLast((sample) => sample.score !== null)?.score ?? null;
  let status: AttitudeStatus = "idle";
  if (answering) status = last?.score == null ? "checking" : "measuring";
  return { status, score: status === "idle" ? null : latest };
}

/** S06 화상: 내 카메라 아래 면접 태도 타일. 접으면 한 줄로 줄어든다 */
export function AttitudeTile({
  samples,
  answering,
}: Readonly<{ samples: readonly AttitudeSample[]; answering: boolean }>) {
  const stored = useInterviewStore((state) => state.attitudeOpen);
  const setOpen = useInterviewStore((state) => state.setAttitudeOpen);
  const { status, score } = attitudeView(samples, answering);
  const shown = score === null ? "–" : String(score);

  const card = (
    <div className="rounded-[18px] border border-white/10 bg-[rgba(14,16,22,0.8)] px-3.5 pt-3 pb-3.5 backdrop-blur-[16px] md:rounded-[20px] md:px-4 md:pt-3.5 md:pb-4">
      <div className="flex items-center gap-1.5">
        <span className="text-xs leading-normal font-bold text-white/70 md:text-[13px]">
          면접 태도
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <StatusDot status={status} />
          <span
            aria-hidden="true"
            className="hidden text-[11px] leading-normal font-medium text-white/60 md:inline"
          >
            {STATUS_LABEL[status]}
          </span>
        </span>
        <ToggleButton open onClick={() => setOpen(false)} />
      </div>
      <p className="flex items-baseline gap-1">
        <span
          className={`text-[32px] leading-tight font-bold tabular-nums md:text-[40px] ${status === "measuring" ? "text-white" : "text-white/35"}`}
        >
          {shown}
        </span>
        {score !== null && (
          <span
            className={`text-xs font-bold md:text-sm ${status === "measuring" ? "text-white/50" : "text-white/25"}`}
          >
            점
          </span>
        )}
        <span className="sr-only">{STATUS_LABEL[status]}</span>
      </p>
      <div className="mt-1.5 h-8 md:h-11">
        {status === "idle" ? (
          <div className="h-1/2 border-b-2 border-dashed border-white/18" />
        ) : (
          <AttitudeTrend samples={samples} dimmed={status === "checking"} />
        )}
      </div>
    </div>
  );
  const pill = (
    <div className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-[rgba(14,16,22,0.8)] pr-1.5 pl-3.5 backdrop-blur-[16px] md:h-10 md:pr-2 md:pl-4">
      <StatusDot status={status} />
      <span className="text-xs leading-normal font-bold text-white/70 md:text-[13px]">
        면접 태도
      </span>
      <span className="ml-auto text-sm font-bold text-white tabular-nums md:text-[15px]">
        {shown}
      </span>
      <span className="sr-only">{STATUS_LABEL[status]}</span>
      <ToggleButton open={false} onClick={() => setOpen(true)} />
    </div>
  );

  // 아직 누르지 않았으면 화면 폭(CSS)으로 고른다: 데스크톱은 펼침, 모바일은 접힘. 서버에서 그린 첫 화면부터 맞아 깜빡이지 않는다
  let body;
  if (stored === null)
    body = (
      <>
        <div className="hidden md:block">{card}</div>
        <div className="md:hidden">{pill}</div>
      </>
    );
  else body = stored ? card : pill;

  return (
    <section
      aria-label="면접 태도"
      className="absolute top-[216px] right-4 z-10 w-[180px] md:top-[260px] md:right-6 md:w-60"
    >
      {body}
    </section>
  );
}

/** 최근 30초 점수 선. 점수가 없는(null) 때는 건너뛰고 잇는다. 오른쪽 끝 점이 지금이다 */
function AttitudeTrend({
  samples,
  dimmed,
}: Readonly<{ samples: readonly AttitudeSample[]; dimmed: boolean }>) {
  const data = samples
    .filter((sample) => sample.score !== null)
    .map((sample) => ({ at: sample.receivedAt, score: sample.score }));
  const lastIndex = data.length - 1;
  return (
    <div className={`size-full ${dimmed ? "opacity-40" : ""}`} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="attitude-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} hide />
          <YAxis hide width={0} domain={["dataMin - 5", "dataMax + 5"]} />
          <Area
            dataKey="score"
            type="monotone"
            stroke="var(--color-brand)"
            strokeWidth={2}
            fill="url(#attitude-fill)"
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === lastIndex && !dimmed ? (
                <circle
                  key="now"
                  cx={props.cx}
                  cy={props.cy}
                  r={3.5}
                  fill="var(--color-brand)"
                  stroke="rgb(14,16,22)"
                  strokeWidth={2}
                />
              ) : (
                <g key={props.index} />
              )
            }
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 상태 점. 측정 중에만 주황으로 천천히 깜빡인다(움직임 줄이기 설정이면 깜빡이지 않는다) */
function StatusDot({ status }: Readonly<{ status: AttitudeStatus }>) {
  const reduced = useReducedMotion();
  const measuring = status === "measuring";
  return (
    <motion.span
      aria-hidden="true"
      className={`size-1.5 shrink-0 rounded-full ${measuring ? "bg-brand" : "bg-white/40"}`}
      animate={measuring && !reduced ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
      transition={
        measuring && !reduced ? { duration: 2, repeat: Infinity, ease: "easeInOut" } : undefined
      }
    />
  );
}

/** 접기 · 펼치기. 질문 말풍선의 꺾쇠 버튼과 같은 모양이다 */
function ToggleButton({ open, onClick }: Readonly<{ open: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      aria-label={open ? "면접 태도 접기" : "면접 태도 펼치기"}
      aria-expanded={open}
      onClick={onClick}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/12 transition-colors hover:bg-white/22"
    >
      <Image
        src="/interview/icon-chevron-down.svg"
        alt=""
        width={14}
        height={14}
        className={open ? "rotate-180" : ""}
      />
    </button>
  );
}
