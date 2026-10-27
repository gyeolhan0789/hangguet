"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

import { type HistoryItem, useInterviewHistoryStore } from "@/stores/interview-history-store";
import { useInterviewStore } from "@/stores/interview-store";

// 기준: 사용자 요청(2026-10-27: 면접 중 지난 질문 · 답변 히스토리, 펼치기 · 접기, 모바일은 글자를 줄인다,
// 카드 · 알약 버튼처럼 보이지 않게 — 대화가 이어진 기록처럼, 밝은 배경에서도 읽히게 가장자리가 옅어지는 그림자만 깐다).
// Figma에 없는 화면이라 S06 말풍선 글자 색(흰색 · 흰색 70%)과 면접관 이름 색(brand)을 쓴다.

// 다른 면접일 때 돌려줄 빈 목록. 매번 새 배열을 돌려주면 store 구독이 바뀐 것으로 보고 끝없이 다시 그린다.
const NO_ITEMS: HistoryItem[] = [];

/**
 * 이번 면접에서 답한 질문과 내 답변. 질문 말풍선 위에 대화가 이어지듯 보이고, 말풍선의 꺾쇠로 접으면 숨는다
 * (접기는 하나로 — 사용자 요청 2026-10-27). 답한 질문이 없으면 그리지 않는다. 새 답이 쌓이면 맨 아래(최근)를 보여 준다.
 */
export function InterviewHistory({ sessionId }: { sessionId: number }) {
  const reduce = useReducedMotion();
  const items = useInterviewHistoryStore((state) =>
    state.sessionId === sessionId ? state.items : NO_ITEMS,
  );
  const collapsed = useInterviewStore((state) => state.collapsed);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [items, collapsed]);
  if (items.length === 0) return null;

  return (
    <div className="flex w-full flex-col items-start [text-shadow:0_1px_8px_rgba(11,13,20,0.9)]">
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.ol
            ref={list}
            aria-label="이전 질문과 내 답변"
            className="flex max-h-[min(36vh,300px)] w-full flex-col gap-4 -ml-4 overflow-y-auto bg-[linear-gradient(to_right,rgba(11,13,20,0),rgba(11,13,20,0.7)_20px,rgba(11,13,20,0.35)_60%,rgba(11,13,20,0))] py-1 pr-6 pl-5 tracking-[-0.2px] [mask-image:linear-gradient(to_bottom,transparent,black_24px)]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {items.map((item) => (
              <li
                key={item.seq}
                className="flex flex-col gap-1 border-l-2 border-white/20 pl-3 first:mt-6"
              >
                <p className="text-sm leading-normal font-semibold text-white/90 sm:text-[15px]">
                  <span className="mr-1.5 font-bold text-brand">Q{item.seq}</span>
                  {item.question}
                </p>
                {item.answer && (
                  <p className="text-[13px] leading-normal font-medium break-words whitespace-pre-wrap text-white/75 sm:text-sm">
                    {item.answer}
                  </p>
                )}
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
