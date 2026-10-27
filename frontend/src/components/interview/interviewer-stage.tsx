"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { interviewerLook } from "@/lib/interviewer/models";
import type { InterviewerScene } from "@/lib/interviewer/scene";
import type { Persona } from "@/types/api";
import type { QuestionMessage, ReactionSnapshot } from "@/lib/interview/room-messages";
import { LIP_SYNC_DELAY_MS, mouthAt, mouthCues, mouthEndMs } from "@/lib/interviewer/lip-sync";
import { NEUTRAL_FACE } from "@/lib/interviewer/face-rules";
import {
  reactionFrame,
  listeningNodPitch,
  LISTENING_PAUSE_MS,
  LISTENING_NOD_DURATION_MS,
  type ListeningActivity,
} from "@/lib/interviewer/reaction";
import { REACTION_DURATION_MS } from "@/lib/interview/room-messages";

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

/** 눈 깜빡임 간격(ms). 이 범위에서 매번 다르게 고른다. */
const BLINK_GAP_MS = [2500, 5500] as const;
/** 눈을 감았다 뜨는 데 걸리는 시간(ms) */
const BLINK_MS = 160;

type StageState = "loading" | "ready" | "failed";

/** 화면 전체에 깔리는 면접관 3D 장면. 3D 모델이 없는 면접관이면 아무것도 그리지 않는다. */
export function InterviewerStage({
  persona,
  feedback = null,
  speaking = false,
  listening = null,
  question = null,
}: {
  persona: Persona;
  feedback?: ReactionSnapshot | null;
  speaking?: boolean;
  listening?: ListeningActivity | null;
  /** 지금 질문 메시지. 음성이 시작되면(started) 발음 시각대로 입을 움직인다 */
  question?: QuestionMessage | null;
}) {
  const look = interviewerLook(persona);
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
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = () => {
      current.setFace({ emotion: "neutral", emotionWeight: 0 });
      current.setHead(0, 0);
    };
    reset();
    const reacting =
      !!feedback?.message.reaction &&
      feedback.receivedAt + REACTION_DURATION_MS > performance.now();
    if (!speaking && feedback?.message.reaction) {
      const remaining = feedback.receivedAt + REACTION_DURATION_MS - performance.now();
      if (remaining > 0) {
        if (reduce) {
          const target = reactionFrame(feedback, feedback.receivedAt + REACTION_DURATION_MS / 2);
          current.setFace({ emotion: target.emotion, emotionWeight: target.emotionWeight });
          timer = setTimeout(reset, remaining);
        } else {
          const draw = () => {
            const now = performance.now();
            const next = reactionFrame(feedback, now);
            current.setFace({ emotion: next.emotion, emotionWeight: next.emotionWeight });
            current.setHead(next.pitch, next.roll);
            if (now < feedback.receivedAt + REACTION_DURATION_MS)
              frame = requestAnimationFrame(draw);
          };
          frame = requestAnimationFrame(draw);
        }
      }
    }
    if (!speaking && !reduce && listening && !reacting) {
      const startAt = listening.speechAt + LISTENING_PAUSE_MS;
      const endAt = startAt + LISTENING_NOD_DURATION_MS;
      const draw = () => {
        const now = performance.now();
        current.setHead(listeningNodPitch(listening, now), 0);
        if (now < endAt) frame = requestAnimationFrame(draw);
      };
      if (performance.now() < endAt) {
        const remaining = startAt - performance.now();
        if (remaining > 0)
          timer = setTimeout(() => {
            frame = requestAnimationFrame(draw);
          }, remaining);
        else frame = requestAnimationFrame(draw);
      }
    }
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      reset();
    };
  }, [state, feedback, speaking, listening, reduce]);

  // 립싱크. 질문 음성이 시작되면 받은 때부터 LIP_SYNC_DELAY_MS 뒤를 0으로 글자별 입 모양을 바꾸고, 끝나면 입을 닫는다.
  // 음성이 끝나거나(ended · failed) 다른 질문이 오면 효과를 다시 실행해 입을 닫는다.
  const alignment = question?.speech === "started" ? question.alignment : null;
  useEffect(() => {
    if (state !== "ready" || !scene.current || reduce || !alignment) return;
    const current = scene.current;
    const cues = mouthCues(alignment.chars);
    const end = mouthEndMs(cues);
    const start = performance.now() + LIP_SYNC_DELAY_MS;
    let frame = 0;
    const draw = () => {
      const at = performance.now() - start;
      current.setFace({ mouth: mouthAt(cues, at) });
      if (at < end) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      current.setFace({ mouth: NEUTRAL_FACE.mouth });
    };
  }, [state, alignment, reduce]);

  // 눈 깜빡임. 동작 줄이기를 켰으면 깜빡이지 않는다.
  useEffect(() => {
    if (state !== "ready" || reduce) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const [min, max] = BLINK_GAP_MS;
      timer = setTimeout(
        () => {
          scene.current?.setFace({ blink: 1 });
          timer = setTimeout(() => {
            scene.current?.setFace({ blink: 0 });
            next();
          }, BLINK_MS);
        },
        min + Math.random() * (max - min),
      );
    };
    next();
    return () => clearTimeout(timer);
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
        <div
          role="status"
          aria-label="면접관을 불러오는 중"
          className="absolute top-[32%] left-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <ThinkingAvatar persona={persona} />
        </div>
      )}
      {state === "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- 화면 전체를 덮는 배경 그림이라 크기를 정할 수 없다.
        <img src={look.still} alt="" className="size-full object-cover" />
      )}
    </div>
  );
}
