"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { preloadInterviewer } from "@/lib/interviewer/preload";
import { useInterviewerPreloadStore } from "@/stores/interviewer-preload-store";
import type { Persona, SessionResponse } from "@/types/api";

// 기준: 사용자 요청(2026-10-27: 채팅 면접은 질문 준비 · 면접관 모델 준비가 오래 걸려 대기 화면을 둔다, 게임은 탑 쌓기,
// 막대마다 속도를 조금씩 다르게, 딱 맞게 쌓으면 퍼펙트 효과, 제목 '면접관이 면접을 준비하고 있어요' · 소제목 '간단한 게임으로 긴장을 풀어볼까요?')
// · 사용자 요청(2026-10-27: 게임이 끝난 뒤 로딩이 없게 — 질문 준비가 끝나면 게임 중에 5.4를 미리 보내 둔다(선로딩))
// · 웹 Swagger 5.2(planStatus · planProgress 0~100) · 사용자 결정(2026-10-22: 진행률은 질문 준비 · 모델 받기 중 작은 쪽)
// Figma에 없는 화면이라 면접 화면 색(S06 Dim rgba(11,13,20,.6) · Modal 둥글기 24 · 패딩 32)과 S05 준비 줄(brand-strong 채움)을 쓴다.

/** 블록 한 칸의 높이(px, 캔버스 좌표) */
const BLOCK_H = 26;
/** 첫 블록 너비 · 캔버스 크기(캔버스 좌표) */
const BASE_W = 220;
const CANVAS_W = 400;
const CANVAS_H = 300;

/**
 * S06-B 채팅 면접 대기 화면. 질문 준비(5.2)와 면접관 모델 받기가 끝날 때까지 탑 쌓기를 하며 기다린다.
 * 면접 시작(5.4)은 질문 준비가 끝나면 면접 화면이 미리 보내 두고, 다 되면 [면접 시작]으로 면접방에 들어간다.
 */
export function ChatWaiting({
  open,
  persona,
  planStatus,
  planProgress,
  started,
  startError,
  onStart,
}: {
  open: boolean;
  persona: Persona;
  planStatus: SessionResponse["planStatus"];
  planProgress: SessionResponse["planProgress"];
  /** 면접을 미리 시작해 뒀다(5.4 · 5.2 IN_PROGRESS). 면접방이 열리고 면접관이 첫 질문을 준비해 둔다 */
  started: boolean;
  /** 미리 보낸 5.4가 실패한 문구(서버 detail). 면접 화면이 2초 뒤 다시 보낸다 */
  startError?: string;
  onStart: () => void;
}) {
  const reduce = useReducedMotion();
  const modelStatus = useInterviewerPreloadStore((state) =>
    state.persona === persona ? state.status : "idle",
  );
  const modelProgress = useInterviewerPreloadStore((state) =>
    state.persona === persona ? state.progress : 0,
  );
  useEffect(() => {
    if (open) preloadInterviewer(persona);
  }, [open, persona]);

  const plan = planStatus === "READY" ? 100 : (planProgress ?? 0);
  const percent = Math.round(Math.min(plan, modelProgress * 100));
  // 질문 준비 · 모델 받기 · 면접 시작(선로딩)이 모두 끝나야 [면접 시작]을 보인다. 누르면 바로 첫 질문을 받는다.
  const ready = planStatus === "READY" && modelStatus === "ready" && started;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(11,13,20,0.6)] px-4 backdrop-blur-[6px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.section
            aria-labelledby="chat-waiting-title"
            className="flex w-full max-w-[460px] flex-col gap-4 rounded-3xl bg-[#191f28] p-6 tracking-[-0.2px] sm:p-8"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="flex flex-col gap-1">
              <h2
                id="chat-waiting-title"
                className="text-[19px] leading-normal font-bold text-white sm:text-[22px]"
              >
                면접관이 면접을 준비하고 있어요
              </h2>
              <p className="text-sm leading-normal font-medium text-white/60 sm:text-[15px]">
                간단한 게임으로 긴장을 풀어볼까요?
              </p>
            </div>
            <StackGame />
            {ready ? (
              <button
                type="button"
                onClick={onStart}
                className="flex h-[52px] w-full cursor-pointer items-center justify-center rounded-[14px] bg-brand-strong text-base leading-normal font-bold text-white"
              >
                면접 시작
              </button>
            ) : modelStatus === "failed" ? (
              <div role="alert" className="flex items-center justify-between gap-3">
                <span className="text-sm leading-normal font-bold text-[#ff8a8a]">
                  면접 준비에 실패했어요
                </span>
                <button
                  type="button"
                  onClick={() => preloadInterviewer(persona)}
                  className="h-9 shrink-0 cursor-pointer rounded-[10px] bg-white/10 px-3.5 text-sm leading-normal font-bold text-white"
                >
                  다시 시도
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm leading-normal font-bold">
                  <span className="text-white/70">준비 중</span>
                  <span className="font-extrabold text-white">{percent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="면접 준비"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
                >
                  <motion.div
                    className="h-full rounded-full bg-brand-strong"
                    initial={false}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>
                {startError && (
                  <p role="alert" className="text-[13px] leading-normal font-medium text-[#ff8a8a]">
                    {startError}
                  </p>
                )}
              </div>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface Block {
  x: number;
  w: number;
}

/** 아래 블록과 이만큼(px) 안으로 맞추면 퍼펙트: 잘리지 않고 아래 블록에 딱 맞춘다 */
export const PERFECT_PX = 4;
/** 블록 색: 한끗 불꽃처럼 아래는 붉은 주황, 위로 갈수록 노랑. 층마다 이 순서를 오르내린다 */
const FLAME = ["#ff4d1f", "#ff6a1f", "#ff7a26", "#ff9a3d", "#ffb547", "#ffd166"];
/** 움직이는 블록(불꽃 끝처럼 가장 밝게) */
const FLAME_TIP = ["#ffb547", "#ffe08a"];
/** 퍼펙트 반짝이 개수(블록 둘레로 퍼진다) */
const SPARKS = 8;

/** 블록 하나가 움직이는 속도(캔버스 좌표 px/프레임). 층이 오를수록 빨라지고, 막대마다 ±20% 안에서 조금씩 다르다 */
export function blockSpeed(floor: number, random: () => number = Math.random) {
  const base = Math.min(7, 2.6 + floor * 0.22);
  return base * (0.8 + random() * 0.4);
}

/** 떨어뜨린 블록이 아래 블록과 겹치는 부분. 겹치지 않으면 null(끝). 퍼펙트면 아래 블록과 같은 자리 · 너비 */
export function overlap(below: Block, moving: Block): (Block & { perfect: boolean }) | null {
  if (Math.abs(below.x - moving.x) <= PERFECT_PX) return { x: below.x, w: below.w, perfect: true };
  const left = Math.max(below.x, moving.x);
  const right = Math.min(below.x + below.w, moving.x + moving.w);
  return right > left ? { x: left, w: right - left, perfect: false } : null;
}

/** 탑 쌓기: 좌우로 움직이는 블록을 탭 · 클릭 · 스페이스로 떨어뜨려 쌓는다. 어긋난 만큼 잘려 나가고, 다 잘리면 끝 */
function StackGame() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [floors, setFloors] = useState(0);
  const [over, setOver] = useState(false);
  // 퍼펙트가 연달아 몇 번인지. 바뀔 때마다 '퍼펙트!' 글자와 반짝이가 다시 나온다(at: 맞춘 블록의 자리, 캔버스 대비 %)
  const [perfect, setPerfect] = useState({
    count: 0,
    id: 0,
    at: { left: 0, top: 0, width: 0, height: 0 },
  });
  const reduce = useReducedMotion();
  const game = useRef({
    blocks: [{ x: (CANVAS_W - BASE_W) / 2, w: BASE_W }] as Block[],
    moving: { x: 0, w: BASE_W } as Block,
    dir: 1,
    speed: blockSpeed(0),
    over: false,
    camera: 0,
  });

  function restart() {
    game.current = {
      blocks: [{ x: (CANVAS_W - BASE_W) / 2, w: BASE_W }],
      moving: { x: 0, w: BASE_W },
      dir: 1,
      speed: blockSpeed(0),
      over: false,
      camera: 0,
    };
    setFloors(0);
    setOver(false);
    setPerfect((prev) => ({ ...prev, count: 0 }));
  }

  function drop() {
    const g = game.current;
    if (g.over) return restart();
    const placed = overlap(g.blocks[g.blocks.length - 1], g.moving);
    if (!placed) {
      g.over = true;
      setOver(true);
      return;
    }
    g.blocks.push({ x: placed.x, w: placed.w });
    if (placed.perfect) {
      // 화면이 따라 올라간 뒤의 자리(카메라 목표)에 반짝이를 띄운다
      const camera = cameraTarget(g.blocks.length);
      const at = {
        left: (placed.x / CANVAS_W) * 100,
        width: (placed.w / CANVAS_W) * 100,
        top: ((CANVAS_H - g.blocks.length * BLOCK_H + camera) / CANVAS_H) * 100,
        height: ((BLOCK_H - 3) / CANVAS_H) * 100,
      };
      setPerfect((prev) => ({ count: prev.count + 1, id: prev.id + 1, at }));
    } else {
      setPerfect((prev) => ({ ...prev, count: 0 }));
    }
    // 다음 블록은 반대쪽 끝에서 나온다
    g.dir = g.dir > 0 ? -1 : 1;
    g.moving = { x: g.dir > 0 ? 0 : CANVAS_W - placed.w, w: placed.w };
    g.speed = blockSpeed(g.blocks.length - 1);
    setFloors(g.blocks.length - 1);
  }

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    let frame = 0;
    const draw = () => {
      const g = game.current;
      if (!g.over) {
        g.moving.x += g.dir * g.speed;
        if (g.moving.x < 0 || g.moving.x + g.moving.w > CANVAS_W) g.dir *= -1;
      }
      g.camera += (cameraTarget(g.blocks.length) - g.camera) * 0.12;
      context.clearRect(0, 0, CANVAS_W, CANVAS_H);
      g.blocks.forEach((block, i) => {
        const y = CANVAS_H - (i + 1) * BLOCK_H + g.camera;
        context.fillStyle = flameFill(context, y, i);
        context.beginPath();
        context.roundRect(block.x, y, block.w, BLOCK_H - 3, 6);
        context.fill();
      });
      if (!g.over) {
        const y = CANVAS_H - (g.blocks.length + 1) * BLOCK_H + g.camera;
        const tip = context.createLinearGradient(0, y, 0, y + BLOCK_H);
        tip.addColorStop(0, FLAME_TIP[1]);
        tip.addColorStop(1, FLAME_TIP[0]);
        context.fillStyle = tip;
        context.beginPath();
        context.roundRect(g.moving.x, y, g.moving.w, BLOCK_H - 3, 6);
        context.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      // [면접 시작] · [다시 시도] 같은 버튼이나 입력에 초점이 있으면 그쪽이 Space를 쓴다
      if (event.target instanceof Element && event.target.closest("button, input, textarea, a"))
        return;
      event.preventDefault();
      drop();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[13px] leading-normal font-bold">
        <span className="text-white/50">탭 · 스페이스로 블록 쌓기</span>
        <span aria-live="polite" className="text-brand">
          {floors}층
        </span>
      </div>
      <div className="relative">
        <canvas
          ref={canvas}
          width={CANVAS_W}
          height={CANVAS_H}
          aria-label="탑 쌓기 게임"
          onPointerDown={(event) => {
            event.preventDefault();
            drop();
          }}
          className="block aspect-[4/3] w-full cursor-pointer touch-manipulation rounded-2xl bg-[#11151d]"
        />
        <AnimatePresence>
          {perfect.count > 0 && !over && !reduce && (
            <PerfectSparkle key={`spark-${perfect.id}`} at={perfect.at} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {perfect.count > 0 && !over && (
            <motion.p
              key={perfect.id}
              aria-live="polite"
              className="pointer-events-none absolute inset-x-0 top-5 text-center text-2xl leading-normal font-extrabold text-white drop-shadow-[0_0_12px_rgba(255,181,71,0.9)]"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 8 }}
              animate={
                reduce
                  ? { opacity: [0, 1, 0] }
                  : { opacity: [0, 1, 1, 0], scale: [0.6, 1.15, 1, 1], y: 0 }
              }
              transition={{ duration: 0.9, times: reduce ? undefined : [0, 0.25, 0.7, 1] }}
            >
              퍼펙트!{perfect.count > 1 && ` ×${perfect.count}`}
            </motion.p>
          )}
        </AnimatePresence>
        {over && (
          <p className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-2xl bg-[rgba(11,13,20,0.7)] text-center">
            <span className="text-xl leading-normal font-bold text-white">{floors}층 쌓았어요</span>
            <span className="text-sm leading-normal font-medium text-white/70">
              탭해서 다시 하기
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

/** 블록이 n개일 때 화면이 따라 올라갈 높이(맨 위가 캔버스 70% 높이에 오도록) */
function cameraTarget(blocks: number) {
  return Math.max(0, (blocks + 1) * BLOCK_H - CANVAS_H * 0.7);
}

/** i층 블록의 불꽃 그라데이션(위가 밝다). 층이 오를수록 붉은 주황 → 노랑을 오르내린다 */
function flameFill(context: CanvasRenderingContext2D, y: number, floor: number) {
  const cycle = FLAME.length - 1;
  const step = floor % (cycle * 2);
  const index = Math.min(step <= cycle ? step : cycle * 2 - step, cycle - 1);
  const fill = context.createLinearGradient(0, y, 0, y + BLOCK_H);
  fill.addColorStop(0, FLAME[index + 1]);
  fill.addColorStop(1, FLAME[index]);
  return fill;
}

/**
 * 퍼펙트 반짝임(motion): 맞춘 블록 둘레로 빛 테두리가 퍼지며 사라지고, 반짝이 별이 사방으로 튄다.
 * 크기 키프레임을 0에서 시작하면 Motion 14에서 그려지지 않는 문제가 있어 0.3부터 시작한다.
 */
function PerfectSparkle({
  at,
}: {
  at: { left: number; top: number; width: number; height: number };
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      <motion.span
        className="absolute rounded-md border-2 border-white shadow-[0_0_16px_rgba(255,209,102,0.9)]"
        style={{
          left: `${at.left}%`,
          top: `${at.top}%`,
          width: `${at.width}%`,
          height: `${at.height}%`,
        }}
        initial={{ opacity: 1, scale: 1 }}
        animate={{ opacity: 0, scale: 1.25 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
      {Array.from({ length: SPARKS }, (_, i) => {
        const angle = (i / SPARKS) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className="absolute size-3 bg-[#ffe08a] [clip-path:polygon(50%_0,62%_38%,100%_50%,62%_62%,50%_100%,38%_62%,0_50%,38%_38%)]"
            style={{ left: `${at.left + at.width / 2}%`, top: `${at.top + at.height / 2}%` }}
            initial={{ opacity: 0, scale: 0.3, x: "-50%", y: "-50%" }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0.3, 1.2, 0.5],
              x: ["-50%", `calc(-50% + ${Math.cos(angle) * 56}px)`],
              y: ["-50%", `calc(-50% + ${Math.sin(angle) * 32}px)`],
              rotate: [0, 90],
            }}
            transition={{ duration: 0.7, ease: "easeOut", delay: (i % 2) * 0.05 }}
          />
        );
      })}
    </div>
  );
}
