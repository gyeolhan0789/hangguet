"use client";

import { useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import {
  checkpointNear,
  clock,
  reasonLabel,
  valueAt,
  type ChartPoint,
} from "@/lib/result/timeline";
import type { TimelineCheckpoint } from "@/types/api";

// 기준: 웹 Swagger 6.4 ReplayItem.timeline · 사용자 스케치(2026-10-30) S07-1 다시보기 타임라인.
// 재생 막대의 질문 점과 섞이지 않게 아래에 별도 그래프로 둔다. 그 면접 평균(0) 위는 초록, 아래는 빨강으로 채우고,
// 평균보다 유난히 낮은 지점(체크포인트)에 빨간 점을 찍는다. 그래프를 누르면 영상이 그 위치로 가고, 누른 곳 가까이에
// 체크포인트가 있으면 그래프 아래에 그 지점에서 보완할 점만 이유별로 보여 준다(사용자 결정 2026-10-30).
// 질문 시작은 세로 점선(Q1~Q5)으로 표시하고, 값이 없는 시간(질문을 듣는 시간 등)은 평균(0)으로 보고 같은 실선으로 잇는다.

/** 위아래 표시 범위(표준편차). 이보다 큰 값은 그래프가 늘려 보여 준다 */
const VALUE_RANGE = 3;
// 그래프 좌우 여백(px). 누른 위치를 시간으로 바꿀 때도 같은 값을 쓴다
const SIDE_MARGIN = 8;

export function ReplayTimeline({
  points,
  checkpoints,
  duration,
  offsets,
  time,
  onSeek,
}: {
  points: ChartPoint[];
  checkpoints: TimelineCheckpoint[];
  /** 영상 길이(초) */
  duration: number;
  /** 질문마다 영상 속 위치(초) */
  offsets: number[];
  /** 재생 위치(초) */
  time: number;
  onSeek: (time: number) => void;
}) {
  // 위아래 칠하기는 실제 값(measured)에만 한다. 평균으로 채운 시간은 선만 잇는다
  const data = points.map((point) => ({
    time: point.time,
    value: point.value,
    up: point.measured ? Math.max(point.value, 0) : null,
    down: point.measured ? Math.min(point.value, 0) : null,
  }));
  // 누른 체크포인트. 체크포인트에서 먼 곳을 누르면 비운다
  const [selected, setSelected] = useState<TimelineCheckpoint | null>(null);

  function select(at: number) {
    onSeek(at);
    setSelected(checkpointNear(checkpoints, at));
  }

  return (
    <section className="flex w-full flex-col gap-3 rounded-2xl bg-bg-sub p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base leading-normal font-bold tracking-[-0.3px] text-text-1">
          답변 흐름
        </h2>
        <span className="flex-1" />
        <span className="flex items-center gap-1 text-xs font-semibold text-text-3">
          <span className="size-2 rounded-full bg-success" />
          평소보다 좋음
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-text-3">
          <span className="size-2 rounded-full bg-danger" />
          평소보다 아쉬움
        </span>
      </div>

      {/* 누른 위치를 바로 시간으로 바꾼다. 그래프의 활성 지점(activeLabel)은 마우스 이동 뒤에 갱신돼 누른 순간에는 이전 위치일 수 있다 */}
      <div
        className="h-40 w-full cursor-pointer [&_svg]:outline-none [&_svg_*]:outline-none"
        data-testid="replay-timeline-chart"
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const width = box.width - SIDE_MARGIN * 2;
          if (width <= 0) return;
          const ratio = (event.clientX - box.left - SIDE_MARGIN) / width;
          select(Math.min(Math.max(ratio, 0), 1) * duration);
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: SIDE_MARGIN, bottom: 0, left: SIDE_MARGIN }}
            accessibilityLayer={false}
          >
            <XAxis
              dataKey="time"
              type="number"
              domain={[0, Math.max(duration, 1)]}
              tickFormatter={clock}
              tick={{ fontSize: 11, fill: "var(--color-text-3)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide width={0} domain={[-VALUE_RANGE, VALUE_RANGE]} />
            <Area
              dataKey="up"
              type="monotone"
              stroke="none"
              fill="var(--color-success)"
              fillOpacity={0.18}
              activeDot={false}
              isAnimationActive={false}
            />
            <Area
              dataKey="down"
              type="monotone"
              stroke="none"
              fill="var(--color-danger)"
              fillOpacity={0.18}
              activeDot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="value"
              type="monotone"
              stroke="var(--color-text-2)"
              strokeWidth={2}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            {selected && (
              <ReferenceArea
                x1={selected.start}
                x2={selected.end}
                fill="var(--color-danger)"
                fillOpacity={0.12}
                stroke="var(--color-danger)"
                strokeOpacity={0.4}
              />
            )}
            <ReferenceLine y={0} stroke="var(--color-line)" />
            {offsets.map((offset, index) => (
              <ReferenceLine
                key={offset}
                x={offset}
                stroke="var(--color-text-3)"
                strokeDasharray="3 3"
                label={{
                  value: `Q${index + 1}`,
                  position: "insideTopLeft",
                  fontSize: 11,
                  fill: "var(--color-text-3)",
                }}
              />
            ))}
            <ReferenceLine x={time} stroke="var(--color-brand-strong)" strokeWidth={2} />
            {checkpoints.map((checkpoint) => (
              <ReferenceDot
                key={checkpoint.at}
                x={checkpoint.at}
                // 곡선을 5초 평균으로 그리므로 점도 곡선 위에 찍는다
                y={valueAt(points, checkpoint.at) ?? checkpoint.value}
                r={6}
                fill="var(--color-danger)"
                stroke="white"
                strokeWidth={2}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {selected ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-bold text-text-1">
            <span className="size-2 rounded-full bg-danger" />
            {clock(selected.at)} 보완할 점
          </p>
          <ul className="flex flex-col gap-2">
            {selected.reasons.map((reason) => (
              <li
                key={reason.metric}
                className="flex flex-col gap-1 rounded-xl border border-line bg-bg px-3 py-2.5"
              >
                <span className="text-xs font-semibold text-danger">{reasonLabel(reason)}</span>
                <span className="text-sm leading-normal text-text-2">{reason.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm leading-normal text-text-3">
          {checkpoints.length > 0
            ? "그래프의 빨간 점을 누르면 그 지점에서 보완할 점이 나와요."
            : "이번 면접에서는 평소보다 유난히 아쉬웠던 지점이 없어요."}
        </p>
      )}
    </section>
  );
}
