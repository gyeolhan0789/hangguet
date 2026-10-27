"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Image from "next/image";
import { useState } from "react";

import { useInterviewStore } from "@/stores/interview-store";
import type { CurrentQuestion } from "@/types/api";

// 기준: Figma S06 · S06-B Interviewer Bubble(18:2530: 반투명 rgba(14,16,22,.8) · blur 8 · 테두리 흰색 10% · 둥글기 20
// · 좌우 22 · 위아래 18 · 간격 8 · Speaker(dot 8 · 면접관 이름 14 Bold brand · volume-2 14) · 질문 20 SemiBold 흰색)
// · Swagger 5.2 currentQuestion(id · seq · content)
// · 사용자 요청(2026-10-27: 질문도 펼치기 · 접기, 접으면 한 줄로 '…' 말줄임, 모바일(sm 미만)은 글자를 줄인다 20 → 17,
//   접기는 하나로 — 이 말풍선의 꺾쇠가 이전 질문 기록(InterviewHistory)도 함께 접고 편다,
//   꺾쇠 옆 눈 버튼: 누르면 면접관 · [면접 종료] · [화면 보이기]만 남기고 화면을 모두 숨겨 실제 면접처럼 듣기만으로 연습한다)
// · 모션 메모 S06(18:2569: 질문 글자가 타자 치듯 등장(stagger 0.02s) · 스피커 아이콘 펄스, 답변을 내면 말풍선 위로 사라지고
// 다음 질문 말풍선 아래에서 등장) · 모션 메모 S06-B(18:2615: 전송 → 면접관 '생각 중' 점 3개 → 다음 질문 타자 등장)

/** 글자 하나가 나타나는 간격(모션 메모 stagger 0.02s) */
export const TYPING_STAGGER_S = 0.02;

/**
 * 면접관 질문 말풍선. 질문이 없으면(다음 질문을 만드는 중) '생각 중' 점 3개를 보여 준다.
 * 질문 글은 면접방 메시지를 우선하며, 화면 복구 시 BE 응답을 사용한다.
 */
export function QuestionBubble({
  interviewer,
  question,
}: {
  interviewer: string;
  /** 지금 질문. 다음 질문을 기다리는 중이면 null */
  question:
    (Pick<CurrentQuestion, "seq" | "content"> & Partial<Pick<CurrentQuestion, "id">>) | null;
}) {
  const reduce = useReducedMotion();
  // 접으면 질문을 한 줄로 줄이고 이전 질문 기록도 숨긴다. 다음 질문에서도 사용자가 고른 대로 둔다.
  const collapsed = useInterviewStore((state) => state.collapsed);
  return (
    // 화면 읽기 프로그램이 바뀐 질문을 읽도록 알림 영역(aria-live)은 질문이 바뀌어도 그대로 두고, 안의 말풍선만 바꾼다.
    <div aria-live="polite" className="relative w-full">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.section
          key={question?.seq ?? "thinking"}
          aria-label={`${interviewer} 질문`}
          className="flex w-full flex-col gap-2 rounded-[20px] border border-white/10 bg-[rgba(14,16,22,0.8)] px-[22px] py-[18px] backdrop-blur-[8px]"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {question ? (
            <TypedQuestion
              key={question.seq}
              interviewer={interviewer}
              content={question.content}
              collapsed={collapsed}
            />
          ) : (
            <>
              <Speaker interviewer={interviewer} speaking={false}>
                <BubbleActions />
              </Speaker>
              <ThinkingDots />
            </>
          )}
        </motion.section>
      </AnimatePresence>
    </div>
  );
}

function Speaker({
  interviewer,
  speaking,
  children,
}: {
  interviewer: string;
  speaking: boolean;
  children?: React.ReactNode;
}) {
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
      {children}
    </div>
  );
}

/** 질문 글자를 하나씩 보여 준다. 다 나오면 스피커 펄스를 멈춘다. 동작 줄이기면 한 번에 보여 준다. */
function TypedQuestion({
  interviewer,
  content,
  collapsed,
}: {
  interviewer: string;
  content: string;
  collapsed: boolean;
}) {
  const reduce = useReducedMotion();
  const letters = Array.from(content);
  const [typing, setTyping] = useState(!reduce);

  return (
    <>
      <Speaker interviewer={interviewer} speaking={typing}>
        <BubbleActions />
      </Speaker>
      <p
        className={`text-[17px] leading-normal font-semibold text-white sm:text-xl ${collapsed ? "line-clamp-1" : ""}`}
      >
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

/**
 * 말풍선 머리 오른쪽의 눈 · 꺾쇠. 질문을 기다리는 중('생각 중')에도 둔다.
 * 눈: 화면 숨기기 · 꺾쇠: 지금 질문 한 줄 말줄임 + 이전 질문 기록 접기(사용자 요청 2026-10-27)
 */
function BubbleActions() {
  const collapsed = useInterviewStore((state) => state.collapsed);
  const toggleCollapsed = useInterviewStore((state) => state.toggleCollapsed);
  const toggleUiHidden = useInterviewStore((state) => state.toggleUiHidden);
  return (
    <span className="-my-1.5 -mr-1.5 ml-auto flex shrink-0 gap-1.5">
      <BubbleButton label="화면 숨기기" onClick={toggleUiHidden}>
        <Image src="/interview/icon-eye.svg" alt="" width={18} height={18} />
      </BubbleButton>
      <BubbleButton
        label={collapsed ? "질문 펼치기" : "질문 접기"}
        expanded={!collapsed}
        onClick={toggleCollapsed}
      >
        <Image
          src="/interview/icon-chevron-down.svg"
          alt=""
          width={18}
          height={18}
          className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
        />
      </BubbleButton>
    </span>
  );
}

/** 말풍선 머리의 둥근 아이콘 버튼(눈 · 꺾쇠). 어두운 말풍선 위에서 보이도록 옅은 흰 바탕을 깐다 */
function BubbleButton({
  label,
  pressed,
  expanded,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      onClick={onClick}
      className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-white/12 transition-colors hover:bg-white/22 aria-pressed:bg-white/25"
    >
      {children}
    </button>
  );
}

/**
 * 화면을 숨긴 동안(눈 버튼) [면접 종료]와 함께 남는 버튼. 누르면 화면을 다시 보인다(사용자 요청 2026-10-27: 눈만 남기고 모두 숨긴다).
 */
export function ShowUiButton() {
  const uiHidden = useInterviewStore((state) => state.uiHidden);
  const toggleUiHidden = useInterviewStore((state) => state.toggleUiHidden);
  if (!uiHidden) return null;
  return (
    <button
      type="button"
      aria-label="화면 보이기"
      aria-pressed
      onClick={toggleUiHidden}
      className="absolute right-4 bottom-6 z-20 flex size-12 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-[rgba(14,16,22,0.8)] backdrop-blur-[8px] transition-colors hover:bg-[rgba(14,16,22,0.95)]"
    >
      <Image src="/interview/icon-eye-off.svg" alt="" width={22} height={22} />
    </button>
  );
}
