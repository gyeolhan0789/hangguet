"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useState } from "react";

import type { CurrentQuestion } from "@/types/api";

// 기준: Figma S06 · S06-B Interviewer Bubble(18:2530: 반투명 rgba(14,16,22,.8) · blur 8 · 테두리 흰색 10% · 둥글기 20
// · 좌우 22 · 위아래 18 · 간격 8 · Speaker(dot 8 · 면접관 이름 14 Bold brand · volume-2 14) · 질문 20 SemiBold 흰색)
// · Swagger 5.2 currentQuestion(id · seq · content)
// · 모션 메모 S06(18:2569: 질문 글자가 타자 치듯 등장(stagger 0.02s) · 스피커 아이콘 펄스, [답변 완료] → 말풍선 위로 사라지고
// 다음 질문 말풍선 아래에서 등장) · 모션 메모 S06-B(18:2615: 전송 → 면접관 '생각 중' 점 3개 → 다음 질문 타자 등장)

/** 글자 하나가 나타나는 간격(모션 메모 stagger 0.02s) */
export const TYPING_STAGGER_S = 0.02;

/**
 * 면접관 질문 말풍선. 질문이 없으면(다음 질문을 만드는 중) '생각 중' 점 3개를 보여 준다.
 * 질문 음성(TTS)은 아직 연결하지 않아, 글자는 화면에 들어온 때부터 타자 치듯 나온다.
 */
export function QuestionBubble({
  interviewer,
  question,
}: {
  interviewer: string;
  /** 지금 질문. 다음 질문을 기다리는 중이면 null */
  question: CurrentQuestion | null;
}) {
  const reduce = useReducedMotion();
  return (
    // 화면 읽기 프로그램이 바뀐 질문을 읽도록 알림 영역(aria-live)은 질문이 바뀌어도 그대로 두고, 안의 말풍선만 바꾼다.
    <div aria-live="polite" className="relative w-full">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.section
          key={question?.id ?? "thinking"}
          aria-label={`${interviewer} 질문`}
          className="flex w-full flex-col gap-2 rounded-[20px] border border-white/10 bg-[rgba(14,16,22,0.8)] px-[22px] py-[18px] backdrop-blur-[8px]"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {question ? (
            <TypedQuestion key={question.id} interviewer={interviewer} content={question.content} />
          ) : (
            <>
              <Speaker interviewer={interviewer} speaking={false} />
              <ThinkingDots />
            </>
          )}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}

function Speaker({ interviewer, speaking }: { interviewer: string; speaking: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <Image src="/interview/dot.svg" alt="" width={8} height={8} />
      <span className="text-sm leading-normal font-bold text-brand">{interviewer}</span>
      <motion.span
        aria-hidden
        className="flex"
        // 시작값과 끝값이 같은 transform 키프레임은 Motion 14에서 그려지지 않는 문제가 있어 투명도로만 깜빡인다.
        animate={speaking ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
        transition={speaking ? { duration: 0.8, repeat: Infinity } : { duration: 0.2 }}
      >
        <Image src="/interview/icon-volume-2.svg" alt="" width={14} height={14} />
      </motion.span>
    </div>
  );
}

/** 질문 글자를 하나씩 보여 준다. 다 나오면 스피커 펄스를 멈춘다. 동작 줄이기면 한 번에 보여 준다. */
function TypedQuestion({ interviewer, content }: { interviewer: string; content: string }) {
  const reduce = useReducedMotion();
  const letters = Array.from(content);
  const [typing, setTyping] = useState(!reduce);

  return (
    <>
      <Speaker interviewer={interviewer} speaking={typing} />
      <p className="text-xl leading-normal font-semibold text-white">
        {/* 화면 읽기 프로그램은 글자 조각 대신 질문 전체를 읽는다. */}
        <span className="sr-only">{content}</span>
        <motion.span
          aria-hidden
          initial={reduce ? false : "hidden"}
          animate="shown"
          variants={{ shown: { transition: { staggerChildren: TYPING_STAGGER_S } } }}
          onAnimationComplete={() => setTyping(false)}
        >
          {letters.map((letter, i) => (
            <motion.span
              key={i}
              variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
              transition={{ duration: 0.01 }}
            >
              {letter}
            </motion.span>
          ))}
        </motion.span>
      </p>
    </>
  );
}

/** 면접관 '생각 중' 점 3개(모션 메모 S06-B) */
function ThinkingDots() {
  const reduce = useReducedMotion();
  return (
    <span
      role="status"
      aria-label="면접관이 생각하는 중"
      className="flex h-[30px] items-center gap-1.5"
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-2 rounded-full bg-white/70"
          animate={reduce ? undefined : { opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}
