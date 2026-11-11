"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type Transition,
} from "motion/react";
import { useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { formatElapsed } from "@/lib/interview/questions";
import { GRADE_LABEL, NO_ANSWER } from "@/lib/result/format";
import type { ReplayItem } from "@/types/api";

// 기준: Figma S07-1 Question List(18:4533: '질문' 18 ExtraBold · 'N개' 13 SemiBold text-3 · 간격 10
// · 줄 bg-sub · 둥글기 16 · 좌우 16 · 위아래 14 · 간격 6 · 'Q1' 13 ExtraBold text-3 · '00:42' 13 SemiBold text-3 · 간격 8
// · 등급 12 Bold text-3(아쉬워요 danger) · 질문 15 SemiBold text-1
// · 재생 중인 줄(18:4552): brand-soft · brand 테두리 2 · 'Q3' brand-ink · 질문 ExtraBold)
// · 기획 메모 S07-1(18:3638: 질문 목록 클릭 → 영상이 해당 질문 시점으로 점프, 재생 중인 질문이 오른쪽 목록에서 강조,
//   채팅 면접은 영상 대신 대화 기록 화면(같은 질문 목록))
// · 모션 메모 S07-1(18:4573: 선택 테두리 layoutId 이동) · ReplayItem(seq · question · answer · grade)
// · Figma S07-1 Transcript(18:4530: bg-sub · 둥글기 16 · 좌우 18 · 위아래 14 · 답변 15 Medium text-1)를 답변 칸에 그대로 쓴다
// · S07 질문 아코디언과 같은 chevron(18:2671 · 모션 메모 S07 18:2705: 화살표 rotate 180°)
// · 사용자 결정(2026-10-22):
//   - 펼칠 수 있음은 위아래 꺽쇠로 알린다.
//   - 펼치면 카드가 '질문 N개'가 있던 자리(맨 위)까지 올라간 뒤, 그 아래에 답변(채팅 답변 · 음성 인식 글)이 펼쳐지고 위아래로 살짝 흔들린다.
//   - 접으면 답변 칸이 위로 접히고, 카드가 위아래로 흔들린 뒤 제자리로 돌아간다. 접을 때는 펼칠 때보다 두 배 빠르다.
//   - 맨 위 카드부터 자막 상자 맨 아래까지의 높이에 맞추고, 넘치는 답변은 스크롤한다.

/** 펼친 카드가 맨 위로 올라가는 시간(초). 답변 칸은 카드가 다 올라간 뒤에 펼쳐진다. */
const MOVE_SECONDS = 0.35;

/**
 * 펼친 뒤(답변 칸) · 접을 때(카드) 위아래로 살짝 흔들리는 움직임.
 * 요소에 바로 걸면 Motion 14가 0 → 값 → 0 transform을 GPU(WAAPI)로 돌리다 요소가 안 그려져, motion value(JS)로 움직인다.
 */
const WOBBLE = [0, 6, -2, 0];
const WOBBLE_TRANSITION: Transition = { duration: 0.4, times: [0, 0.4, 0.75, 1], ease: "easeOut" };

/** 접을 때(답변 칸 접기 · 흔들기 · 제자리로)는 펼칠 때 시간의 절반만 쓴다 */
const CLOSE_SPEED = 2;

/**
 * 질문 목록. 펼친 질문(opened)이 있으면 그 카드만 맨 위에 두고 아래에 답변을 펼친다. 다시 누르면 목록으로 돌아간다.
 * fill이면 영상 옆에 놓여 높이가 정해져 있어, 답변 칸이 남은 높이를 채우고 넘치면 스크롤한다.
 */
export function ReplayQuestions({
  items,
  offsets,
  highlighted,
  opened,
  onToggle,
  fill,
}: Readonly<{
  items: ReplayItem[];
  /** 질문마다 영상 속 위치(초) */
  offsets: number[];
  /** 강조할 질문(재생 중인 질문)의 순번. 없으면 -1 */
  highlighted: number;
  /** 펼친 질문의 순번. 없으면 -1 */
  opened: number;
  onToggle: (index: number) => void;
  fill: boolean;
}>) {
  const reduce = useReducedMotion();
  // 접고 제자리로 돌아가는 중이면 두 배 빠르게 움직인다. 다시 펼칠 때 원래 속도로 돌아온다.
  const [returning, setReturning] = useState(false);
  const moveSeconds = returning ? MOVE_SECONDS / CLOSE_SPEED : MOVE_SECONDS;
  const transition = reduce
    ? { duration: 0 }
    : { duration: moveSeconds, ease: "easeInOut" as const };
  const visible = opened >= 0 ? [opened] : items.map((_, i) => i);
  // 답하지 않은 질문(answer null)도 펼쳐 답변 칸에 안내를 둔다. 칸이 없으면 접을 때 칸이 사라지기(onExitComplete)를 기다리다 멈춘다.
  const answer = opened >= 0 ? items[opened].answer : null;
  // 접는 중(답변 칸 접기 → 카드 흔들기 → 제자리). 이 동안은 다시 누르지 않는다.
  const [closing, setClosing] = useState(false);
  const cardY = useMotionValue(0);
  const answerY = useMotionValue(0);

  async function shakeThenClose() {
    await animate(cardY, WOBBLE, {
      ...WOBBLE_TRANSITION,
      duration: WOBBLE_TRANSITION.duration! / CLOSE_SPEED,
    });
    setClosing(false);
    onToggle(opened);
  }

  function toggle(index: number) {
    if (closing) return;
    if (index !== opened || reduce) {
      setReturning(false);
      onToggle(index);
      return;
    }
    setReturning(true);
    // 답변 칸이 다 접힌 뒤(onExitComplete) 카드를 흔든다.
    setClosing(true);
  }

  return (
    <section aria-label="질문" className={`flex w-full flex-col gap-2.5 ${fill ? "h-full" : ""}`}>
      {/* 펼치면 '질문 N개' 머리가 빠지고, 펼친 카드가 그 자리(목록 맨 위)로 올라간다. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {opened < 0 && (
          <motion.div
            key="head"
            layout
            className="flex shrink-0 items-center justify-between tracking-[-0.2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <h2 id="replay-questions" className="text-lg leading-normal font-extrabold text-text-1">
              질문
            </h2>
            <p className="text-[13px] leading-normal font-semibold text-text-3">{items.length}개</p>
          </motion.div>
        )}
      </AnimatePresence>

      <ul className="flex shrink-0 flex-col gap-2.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((i) => (
            <motion.li
              key={items[i].questionId}
              layout
              style={i === opened ? { y: cardY } : undefined}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              <QuestionCard
                item={items[i]}
                offset={offsets[i]}
                highlighted={i === highlighted}
                open={i === opened}
                onToggle={() => toggle(i)}
                shared={opened < 0}
                transition={transition}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <AnimatePresence
        onExitComplete={() => {
          if (closing) void shakeThenClose();
        }}
      >
        {opened >= 0 && !closing && (
          // 카드가 맨 위로 다 올라간 뒤, 카드 아래로 위에서부터 펼쳐진다.
          <motion.div
            key={items[opened].questionId}
            id={`replay-answer-${items[opened].questionId}`}
            className={`rounded-2xl bg-bg-sub px-[18px] py-3.5 ${
              fill ? "min-h-0 flex-1 overflow-y-auto overscroll-contain" : ""
            }`}
            style={{ y: answerY }}
            initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
            animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
            // 접을 때는 기다리지 않고 바로 위로 접힌다.
            exit={{
              opacity: 0,
              clipPath: "inset(0 0 100% 0)",
              transition: { duration: reduce ? 0 : MOVE_SECONDS / CLOSE_SPEED, ease: "easeInOut" },
            }}
            transition={reduce ? { duration: 0 } : { ...transition, delay: MOVE_SECONDS }}
            // 다 펼쳐진 뒤 살짝 흔들리며 자리 잡는다.
            onAnimationComplete={() => {
              if (!reduce && !closing) void animate(answerY, WOBBLE, WOBBLE_TRANSITION);
            }}
          >
            <p
              className={`text-[15px] leading-normal font-medium tracking-[-0.2px] break-keep ${
                answer ? "text-text-1" : "text-text-3"
              }`}
            >
              {answer ?? NO_ANSWER}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function QuestionCard({
  item,
  offset,
  highlighted,
  open,
  onToggle,
  shared,
  transition,
}: Readonly<{
  item: ReplayItem;
  offset: number;
  highlighted: boolean;
  open: boolean;
  onToggle: () => void;
  /**
   * 목록에서 강조 상자가 카드 사이를 옮겨 다닌다(layoutId). 펼칠 때는 끄고 카드 안에 붙여 둔다. layoutId를 켜 두면 강조 상자가
   * 앞서 강조하던 카드 자리에서 출발해, 누른 카드(글자)와 다른 길 · 속도로 올라간다(Motion: layoutId는 이전 요소 자리에서 시작).
   */
  shared: boolean;
  /** 카드(li)가 움직이는 전환. 강조 상자도 같은 속도로 움직인다 */
  transition: Transition;
}>) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      aria-expanded={open}
      // 재생 중인(강조한) 질문을 보조 기술에도 알린다.
      aria-current={highlighted || undefined}
      aria-controls={open ? `replay-answer-${item.questionId}` : undefined}
      onClick={onToggle}
      className="relative flex w-full cursor-pointer flex-col gap-1.5 rounded-2xl bg-bg-sub px-4 py-3.5 text-left tracking-[-0.2px]"
    >
      {highlighted && (
        <motion.span
          layoutId={shared ? "replay-active" : undefined}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-brand bg-brand-soft dark:bg-brand-soft/8"
          // 카드가 움직일 때 글자와 같은 속도로 따라가도록 카드(li)와 같은 전환을 쓴다.
          transition={transition}
        />
      )}
      <span className="relative flex w-full items-center gap-2">
        <span
          className={`text-[13px] leading-normal font-extrabold ${
            highlighted ? "text-brand-ink" : "text-text-3"
          }`}
        >
          Q{item.seq}
        </span>
        <span className="text-[13px] leading-normal font-semibold text-text-3">
          {formatElapsed(offset)}
        </span>
        <span className="flex-1" />
        <span
          className={`text-xs leading-normal font-bold ${
            item.grade === "WEAK" ? "text-danger" : "text-text-3"
          }`}
        >
          {item.grade && GRADE_LABEL[item.grade]}
        </span>
        <motion.span
          className="flex shrink-0"
          initial={false}
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduce ? 0 : 0.25 }}
        >
          <MaskIcon src="/result/icon-chevron-down.svg" size={16} className="bg-text-3" />
        </motion.span>
      </span>
      <span
        className={`relative text-[15px] leading-normal break-keep text-text-1 ${
          highlighted ? "font-extrabold" : "font-semibold"
        }`}
      >
        {item.question}
      </span>
    </button>
  );
}
