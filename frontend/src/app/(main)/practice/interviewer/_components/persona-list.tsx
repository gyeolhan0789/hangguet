"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion, type Variants } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { MaskIcon } from "@/components/mask-icon";
import { PERSONAS, type PersonaInfo } from "@/lib/interview/personas";
import type { Persona } from "@/types/api";

// 기준: Figma S04 Persona List(18:2171: 고른 줄 18:2172 · 안 고른 줄 18:2182 · 준비 중 18:2191) · 토스트(Mic Toast 18:4421)
// · 모션 메모 S04(18:2214): 줄 hover 배경 살짝 진하게 + 아바타 scale 1.06 / 선택 테두리 layoutId 이동(spring 400 · 30)
//   + 라디오 점 scale 0→1 / 고른 아바타 반응(악마 rotate [-6,6,0] · 커피챗 y [0,4,0]) / 준비 중 줄 흔들림 + 토스트 '곧 만나요!'
//   / 목록 첫 등장 y 16→0 stagger 0.06s · 기획 메모 S04(마지막 줄 '또 다른 면접관'은 선택 불가)

const listVariants: Variants = { hidden: {}, shown: { transition: { staggerChildren: 0.06 } } };
const rowVariants: Variants = { hidden: { y: 16, opacity: 0 }, shown: { y: 0, opacity: 1 } };

const TOAST_MS = 2000;

/** 고른 면접관 아바타가 한 번 보이는 반응 */
const AVATAR_REACTION: Record<Persona, { rotate: number[] } | { y: number[] }> = {
  DEVIL: { rotate: [-6, 6, 0] },
  COFFEE_CHAT: { y: [0, 4, 0] },
  // 오리는 Figma에 없어 커피챗처럼 위아래로 한 번 들썩인다(사용자 결정 2026-11-04: 오리 면접관은 기본안대로)
  DUCK: { y: [0, -4, 0] },
};

function PersonaRow({
  info,
  checked,
  onSelect,
}: {
  info: PersonaInfo;
  checked: boolean;
  onSelect: (persona: Persona) => void;
}) {
  const [avatar, animateAvatar] = useAnimate<HTMLSpanElement>();
  const reduce = useReducedMotion();
  const wasChecked = useRef(checked);

  useEffect(() => {
    if (checked && !wasChecked.current && !reduce && avatar.current) {
      animateAvatar(avatar.current, AVATAR_REACTION[info.persona], { duration: 0.4 });
    }
    wasChecked.current = checked;
  }, [checked, reduce, animateAvatar, avatar, info.persona]);

  return (
    <motion.label
      variants={rowVariants}
      // 고른 줄은 Figma처럼 2px 테두리만큼 안쪽 여백이 커진다(18:2172: 116px · 안 고른 줄 18:2182: 112px).
      // 좁은 화면(sm 미만)은 여백 · 간격 · 아바타를 줄여 이름과 태그가 줄바꿈되지 않게 한다.
      // 고른 줄의 배경은 brand-soft 하나뿐이다(다크 18:5719: 페이지 bg 위 brand-soft 8%). 그래서 bg-sub를 빼되,
      // 선택 테두리가 미끄러져 올 때까지 서서히 빠지게 한다.
      className={`group relative flex cursor-pointer items-center gap-3 rounded-[20px] transition-colors duration-300 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand sm:gap-5 ${checked ? "px-[18px] py-[22px] sm:px-[26px]" : "bg-bg-sub px-4 py-5 sm:px-6"}`}
    >
      {checked && (
        // 미끄러지는 동안 다른 줄 글자를 덮지 않도록 줄 내용보다 뒤(-z)에 그린다(fieldset이 isolate).
        <motion.span
          layoutId="persona-selected"
          aria-hidden
          className="absolute inset-0 -z-10 rounded-[20px] border-2 border-brand bg-brand-soft dark:bg-brand-soft/8"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      {/* 줄 hover: 배경이 살짝 진해진다(모션 메모 S04). 라이트 · 다크 모두 어둡게 덮는다. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-[20px] bg-black opacity-0 transition-opacity group-hover:opacity-[0.03]"
      />
      <input
        type="radio"
        name="persona"
        value={info.persona}
        checked={checked}
        onChange={() => onSelect(info.persona)}
        className="sr-only"
      />
      <span ref={avatar} className="relative shrink-0">
        {/* 고른 아바타의 흰 3px 테두리는 이미지 위에 안쪽으로 덮는다(18:2173: stroke INSIDE). 이미지 크기는 그대로다. */}
        <span className="relative block size-14 overflow-hidden rounded-full transition-transform duration-200 group-hover:scale-[1.06] sm:size-18">
          <Image src={info.avatar} alt="" fill sizes="72px" className="object-cover" />
          {checked && <span className="absolute inset-0 rounded-full border-3 border-white" />}
        </span>
      </span>
      <span className="relative flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xl leading-normal font-extrabold tracking-[-0.2px] whitespace-nowrap text-text-1">
            {info.name}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[13px] leading-normal font-bold tracking-[-0.2px] whitespace-nowrap ${checked ? "bg-bg-sub text-brand-ink" : "bg-surface text-text-2"}`}
          >
            {info.difficulty}
          </span>
        </span>
        <span className="text-base leading-normal font-medium tracking-[-0.2px] text-text-2">
          {info.description}
        </span>
      </span>
      <span
        aria-hidden
        className={`relative flex size-[26px] shrink-0 items-center justify-center rounded-full ${checked ? "bg-brand-strong" : "border-2 border-line bg-bg-sub"}`}
      >
        {checked && (
          <motion.span
            className="size-2.5 rounded-full bg-white"
            initial={reduce ? false : { scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
          />
        )}
      </span>
    </motion.label>
  );
}

/** 마지막 줄 '또 다른 면접관'. 고를 수 없고, 누르면 살짝 흔들리며 토스트로 알린다. */
function ComingSoonRow({ onPress }: { onPress: () => void }) {
  const [scope, animate] = useAnimate<HTMLButtonElement>();
  const reduce = useReducedMotion();

  function press() {
    if (!reduce && scope.current) {
      animate(scope.current, { x: [-4, 4, -2, 2, 0] }, { duration: 0.35 });
    }
    onPress();
  }

  return (
    <motion.div variants={rowVariants}>
      <button
        ref={scope}
        type="button"
        onClick={press}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[20px] border border-line bg-bg-sub px-4 py-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:gap-5 sm:px-6"
      >
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-surface sm:size-18">
          <MaskIcon src="/practice/icon-sparkles.svg" size={28} className="bg-text-3" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 tracking-[-0.2px]">
          <span className="text-lg leading-normal font-bold text-text-2">
            또 다른 면접관을 만들고 있어요!
          </span>
          <span className="text-[15px] leading-normal font-medium text-text-3">
            곧 새로운 면접관이 찾아올 거예요
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-[13px] leading-normal font-bold tracking-[-0.2px] whitespace-nowrap text-text-3">
          준비 중
        </span>
      </button>
    </motion.div>
  );
}

export function PersonaList({
  selected,
  onSelect,
}: {
  selected: Persona | null;
  onSelect: (persona: Persona) => void;
}) {
  const reduce = useReducedMotion();
  const [toastAt, setToastAt] = useState<number>();

  useEffect(() => {
    if (toastAt === undefined) return;
    const timer = setTimeout(() => setToastAt(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toastAt]);

  return (
    <>
      <motion.div
        className="flex flex-col gap-3"
        variants={listVariants}
        initial={reduce ? false : "hidden"}
        animate="shown"
      >
        <fieldset className="isolate flex flex-col gap-3">
          <legend className="sr-only">면접관</legend>
          {PERSONAS.map((info) => (
            <PersonaRow
              key={info.persona}
              info={info}
              checked={selected === info.persona}
              onSelect={onSelect}
            />
          ))}
        </fieldset>
        <ComingSoonRow onPress={() => setToastAt(Date.now())} />
      </motion.div>

      <div
        role="status"
        className="pointer-events-none fixed inset-x-0 bottom-[112px] z-20 flex justify-center px-4"
      >
        <AnimatePresence>
          {toastAt !== undefined && (
            <motion.p
              key="toast"
              className="flex h-14 items-center rounded-2xl bg-night-2 px-[18px] text-[15px] leading-normal font-semibold tracking-[-0.2px] text-white"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
            >
              곧 만나요!
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
