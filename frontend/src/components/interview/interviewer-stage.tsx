"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { interviewerLook } from "@/lib/interviewer/models";
import { blinkAt, BLINK_DURATION_MS } from "@/lib/interviewer/blink";
import type { InterviewerScene } from "@/lib/interviewer/scene";
import type { Persona } from "@/types/api";
import type { QuestionMessage, ReactionSnapshot } from "@/lib/interview/room-messages";
import { LIP_SYNC_DELAY_MS, mouthAt, mouthCues, mouthEndMs } from "@/lib/interviewer/lip-sync";
import { NEUTRAL_FACE } from "@/lib/interviewer/face-rules";
import { useInterviewStore } from "@/stores/interview-store";
import {
  gentleReaction,
  isNodReaction,
  reactionFrame,
  listeningNodPitch,
  LISTENING_PAUSE_MS,
  LISTENING_NOD_DURATION_MS,
  type ListeningActivity,
} from "@/lib/interviewer/reaction";

import { ThinkingAvatar } from "./thinking-avatar";

// 기준: Figma S06 · S06-B Interviewer Scene · Jev 3D (animated)(18:2498 · 18:2575: 화면 전체 1440×900, 그 위에 Fade Top · Fade Bottom)
// · 면접관 표현 결정 ③-3(박연수/interviewer-avatar decisions.md: WebGL 미지원 · 로드 실패 · 컨텍스트 손실이면 정지 이미지)
// · 사용자 결정(2026-10-22: 큰 모델이라 시간 제한(결정 ③-3의 10초 Timeout)을 두지 않고, 받는 중이면 로딩 표시를 계속 둔다.
//   실패는 상태로만 정한다 — 받기를 다시 해도 안 될 때 · WebGL을 못 쓸 때 · 그리던 중 컨텍스트를 잃었을 때)
// · Next.js Preserving UI state(Activity: 떠난 화면은 숨겨 두고 돌아오면 효과를 다시 실행한다 — 숨길 때 로딩 상태로 되돌린다)
// · 모션 메모 S06-F(18:4432: 면접관 3D 아이들 모션에 눈 깜빡임)
// · 면접 데모(interview_prototype env/storm.js: 악마 = 먹구름 번개 영상 배경 · 3D 번개 · 지옥불 · 블룸)
// · 사용자 요청(2026-10-21: 면접관 로딩 화면 — Figma에 없어 S06-1 Thinking Avatar를 면접관 얼굴 자리에 둔다)
// · AI 명세 6.3 interview.question(started의 alignment.chars) · 사용자 결정(2026-10-27: 발음 시각으로 입 모양을 바꾸고 150ms 늦춘다.
//   동작 줄이기를 켰으면 입을 움직이지 않는다. 질문 도중에 들어오면 다음 started부터 움직인다)
// · 오리 면접관(동작 클립 면접관): 오리 모델 안내(public/interview/duck/README.md: 사람의 A/I/U/E/O 입 모양을 쓰지 않음)
//   · API 명세 면접방 메시지(오리는 smile · small_nod · nod만 표시, attitude를 부정적인 표정으로 반영하지 않음)
//   · 사용자 결정(2026-11-04: 질문 음성이 나오는 동안 말하기 동작, 끄덕임 반응 · 듣는 중 끄덕임은 끄덕임 동작 한 번,
//   답변을 내면 감탄 소리와 함께 놀람 동작 한 번)

/** 눈 깜빡임 간격(ms). 이 범위에서 매번 다르게 고른다. */
const BLINK_GAP_MS = [2500, 5500] as const;
/** 동작 클립 면접관이 끄덕임 반응 · 놀람을 시작하는 기한(ms). 받고 이만큼 지나 다시 그리면 하지 않는다 */
const NOD_START_MS = 300;

type StageState = "loading" | "ready" | "failed";

/** 받은 리액션이 아직 끝나지 않았다 */
function reactionActive(shown: ReactionSnapshot | null): boolean {
  const reaction = shown?.message.reaction;
  return !!shown && !!reaction && shown.receivedAt + reaction.durationMs > performance.now();
}

/**
 * 리액션(표정 · 고개)을 남은 시간 동안 그린다. 동작 줄이기면 가운데 시점의 표정만 두었다가 끝나면 onEnd로 되돌린다.
 * 그리기를 멈추는 함수를 돌려준다(그릴 리액션이 없으면 아무것도 하지 않는다).
 */
function playReaction(
  current: InterviewerScene,
  shown: ReactionSnapshot | null,
  options: { reduce: boolean | null; clipped: boolean; onEnd: () => void },
): () => void {
  const reaction = shown?.message.reaction;
  if (!shown || !reaction) return () => {};
  const duration = reaction.durationMs;
  const remaining = shown.receivedAt + duration - performance.now();
  if (remaining <= 0) return () => {};
  if (options.reduce) {
    const target = reactionFrame(shown, shown.receivedAt + duration / 2);
    current.setFace({ emotion: target.emotion, emotionWeight: target.emotionWeight });
    const timer = setTimeout(options.onEnd, remaining);
    return () => clearTimeout(timer);
  }
  // 끄덕임은 반응을 받은 직후 한 번만 한다(반응 도중 효과가 다시 실행돼도 또 끄덕이지 않게)
  if (
    options.clipped &&
    isNodReaction(shown) &&
    performance.now() - shown.receivedAt < NOD_START_MS
  ) {
    current.nod();
  }
  let frame = 0;
  const draw = () => {
    const now = performance.now();
    const next = reactionFrame(shown, now);
    current.setFace({ emotion: next.emotion, emotionWeight: next.emotionWeight });
    if (!options.clipped) current.setHead(next.pitch, next.roll);
    if (now < shown.receivedAt + duration) frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}

/**
 * 듣는 중 끄덕임: 말이 멈추고 LISTENING_PAUSE_MS 뒤에 한 번 끄덕인다. 동작 클립 면접관은 끄덕임 동작을 한 번 하고,
 * 자세 면접관은 고개를 직접 끄덕인다. 끄덕일 때가 이미 지났으면 하지 않는다. 그리기를 멈추는 함수를 돌려준다.
 */
function playListeningNod(
  current: InterviewerScene,
  listening: ListeningActivity,
  clipped: boolean,
): () => void {
  const startAt = listening.speechAt + LISTENING_PAUSE_MS;
  const endAt = startAt + LISTENING_NOD_DURATION_MS;
  if (performance.now() >= endAt) return () => {};
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const draw = clipped
    ? () => current.nod()
    : () => {
        const now = performance.now();
        current.setHead(listeningNodPitch(listening, now), 0);
        if (now < endAt) frame = requestAnimationFrame(draw);
      };
  const remaining = startAt - performance.now();
  if (remaining > 0) {
    timer = setTimeout(() => {
      frame = requestAnimationFrame(draw);
    }, remaining);
  } else {
    frame = requestAnimationFrame(draw);
  }
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

/** 화면 전체에 깔리는 면접관 3D 장면. 3D 모델이 없는 면접관이면 아무것도 그리지 않는다. */
export function InterviewerStage({
  persona,
  feedback = null,
  speaking = false,
  listening = null,
  question = null,
}: Readonly<{
  persona: Persona;
  feedback?: ReactionSnapshot | null;
  speaking?: boolean;
  listening?: ListeningActivity | null;
  /** 지금 질문 메시지. 음성이 시작되면(started) 발음 시각대로 입을 움직인다 */
  question?: QuestionMessage | null;
}>) {
  const look = interviewerLook(persona);
  // 동작 클립 면접관(오리)은 고개를 직접 돌리지 않고 동작(말하기 · 끄덕임)을 재생한다
  const clipped = !!look?.model.clips;
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<StageState>("loading");
  const reduce = useReducedMotion();
  const scene = useRef<InterviewerScene | null>(null);

  useEffect(() => {
    const box = container.current;
    if (!look || !box) return;
    // 캔버스는 실행마다 새로 만든다. 정리할 때 WebGL 컨텍스트를 놓으면(forceContextLoss) 그 캔버스는 다시 쓸 수 없어서다
    // (React 개발 모드는 효과를 두 번 실행한다).
    const element = document.createElement("canvas");
    element.className = "block size-full";
    box.appendChild(element);
    const abort = new AbortController();
    const fail = () => {
      abort.abort();
      setState("failed");
    };
    let resizeObserver: ResizeObserver | null = null;

    // three.js는 이 화면에서만 쓰여, 서버 번들 · 다른 화면에 들어가지 않게 여기서 불러온다.
    import("@/lib/interviewer/scene")
      .then(({ createInterviewerScene }) =>
        createInterviewerScene({
          canvas: element,
          model: look.model,
          frame: look.frame,
          storm: look.storm,
          interior: look.interior,
          background: look.background,
          lights: look.lights,
          onLost: fail,
          signal: abort.signal,
          headBone: look.headBone,
        }),
      )
      .then((created) => {
        if (abort.signal.aborted) {
          created.dispose();
          return;
        }
        scene.current = created;
        resizeObserver = new ResizeObserver(() => created.resize());
        resizeObserver.observe(element);
        setState("ready");
      })
      .catch(() => {
        if (!abort.signal.aborted) setState("failed");
      });

    return () => {
      abort.abort();
      resizeObserver?.disconnect();
      scene.current?.dispose();
      scene.current = null;
      element.remove();
    };
  }, [look]);

  // 화면이 숨겨질 때(Activity) 로딩 상태로 되돌린다. 다시 보일 때 장면을 새로 만들므로, 그동안 로딩 표시를 보여 준다.
  useLayoutEffect(() => () => setState("loading"), []);

  useEffect(() => {
    if (state !== "ready" || !scene.current) return;
    const current = scene.current;
    const reset = () => {
      current.setFace({ emotion: "neutral", emotionWeight: 0 });
      current.setHead(0, 0);
    };
    reset();
    const shown = clipped ? gentleReaction(feedback) : feedback;
    // 리액션이 끝나기 전에는 듣는 중 끄덕임을 하지 않으므로, 둘이 함께 그려지지 않는다.
    // '리액션 중인가'는 리액션의 남은 시간보다 먼저 잰다(나중에 재면 그 사이 끝난 리액션과 끄덕임이 함께 시작된다).
    const reacting = reactionActive(shown);
    const stops: (() => void)[] = [];
    if (!speaking) stops.push(playReaction(current, shown, { reduce, clipped, onEnd: reset }));
    if (!speaking && !reduce && listening && !reacting) {
      stops.push(playListeningNod(current, listening, clipped));
    }
    return () => {
      stops.forEach((stop) => stop());
      reset();
    };
  }, [state, feedback, speaking, listening, reduce, clipped]);

  // 립싱크. 질문 음성이 시작되면 받은 때부터 LIP_SYNC_DELAY_MS 뒤를 0으로 글자별 입 모양을 바꾸고, 끝나면 입을 닫는다.
  // 음성이 끝나거나(ended · failed) 다른 질문이 오면 효과를 다시 실행해 입을 닫는다.
  const alignment = question?.speech === "started" ? question.alignment : null;
  // 동작 클립 면접관(오리)은 입 모양 대신 같은 구간 동안 말하기 동작을 반복한다.
  useEffect(() => {
    if (state !== "ready" || !scene.current || reduce || !alignment) return;
    const current = scene.current;
    const cues = mouthCues(alignment.chars);
    const end = mouthEndMs(cues);
    const start = performance.now() + LIP_SYNC_DELAY_MS;
    let frame = 0;
    let talking = false;
    const draw = () => {
      const at = performance.now() - start;
      const speakingNow = at >= 0 && at < end;
      if (clipped) {
        if (speakingNow !== talking) current.setTalking(speakingNow);
        talking = speakingNow;
      } else current.setFace({ mouth: mouthAt(cues, at) });
      if (at < end) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      if (clipped) current.setTalking(false);
      else current.setFace({ mouth: NEUTRAL_FACE.mouth });
    };
  }, [state, alignment, reduce, clipped]);

  // 오리 면접관의 감탄(답변 제출 시작): 놀람 동작을 한 번 한다. 감탄한 직후에만 한다(화면을 다시 그려도 또 놀라지 않게).
  const exclaimedAt = useInterviewStore((state) => state.exclaimedAt);
  useEffect(() => {
    if (state !== "ready" || !scene.current || !clipped || reduce || exclaimedAt === null) return;
    if (performance.now() - exclaimedAt < NOD_START_MS) scene.current.surprise();
  }, [state, clipped, reduce, exclaimedAt]);

  // 눈 깜빡임. 동작 줄이기를 켰으면 깜빡이지 않는다.
  useEffect(() => {
    if (state !== "ready" || reduce) return;
    let timer: ReturnType<typeof setTimeout>;
    let frame = 0;
    const current = scene.current;
    const next = () => {
      const [min, max] = BLINK_GAP_MS;
      timer = setTimeout(
        () => {
          const startedAt = performance.now();
          const draw = () => {
            const elapsed = performance.now() - startedAt;
            current?.setFace({ blink: blinkAt(elapsed) });
            if (elapsed < BLINK_DURATION_MS) frame = requestAnimationFrame(draw);
            else next();
          };
          frame = requestAnimationFrame(draw);
        },
        min + Math.random() * (max - min),
      );
    };
    next();
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      current?.setFace({ blink: 0 });
    };
  }, [state, reduce]);

  if (!look) return null;
  return (
    <div data-testid="interviewer-stage" data-state={state} className="absolute inset-0">
      <motion.div
        ref={container}
        className={state === "failed" ? "hidden" : "size-full"}
        initial={false}
        animate={{ opacity: state === "ready" ? 1 : 0 }}
        transition={{ duration: reduce ? 0 : 0.5 }}
      />
      {look.storm && (
        // 폭풍 배경 비네트(면접 데모 app.css :root[data-persona="devil"] .vignette 그대로)
        <div
          aria-hidden
          data-testid="storm-vignette"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_85%_at_50%_36%,transparent_40%,rgba(0,0,0,0.7)_100%),linear-gradient(to_bottom,rgba(0,0,0,0.25),transparent_20%,transparent_50%,rgba(10,0,4,0.75))]"
        />
      )}
      {state === "loading" && (
        // 면접관 얼굴 자리(Figma 장면에서 얼굴 가운데 화면 위 32%)에 S06-1과 같은 '생각 중' 아바타를 둔다.
        <output
          aria-label="면접관을 불러오는 중"
          className="absolute top-[32%] left-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <ThinkingAvatar persona={persona} />
        </output>
      )}
      {state === "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- 화면 전체를 덮는 배경 그림이라 크기를 정할 수 없다.
        <img src={look.still} alt="" className="size-full object-cover" />
      )}
    </div>
  );
}
