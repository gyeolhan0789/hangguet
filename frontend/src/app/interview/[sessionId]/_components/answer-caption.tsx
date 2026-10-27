"use client";

import type { ReactNode } from "react";

import type { InterviewRoomStatus } from "@/components/interview/use-interview-room";

// 기준: Figma S06 STT Bubble(18:2539: 흰색 8% · 테두리 흰색 15% · blur 16 · 둥글기 20 · 좌우 22 · 위아래 16 · 간격 10
// · Label(Rec Dot 8 #ff5a5a · 간격 6 · '내 답변 · 듣는 중' 13 Bold 흰색 70%) · 답변 글 18 Medium 흰색(미확정 글은 흐리게)
// · 맨 아래 줄에 파형 · [답변 완료](사용자 요청 2026-10-27: 상자와 통합, 마이크는 빼고 파형 · [답변 완료]를 오른쪽에))
// · Figma S06-Q 질문 듣는 중(344:1577: 질문 음성이 나오는 동안 '내 답변' · '질문이 끝나면 말씀해 주세요' 흐리게)
// · 사용자 요청(2026-10-27: 모바일(sm 미만)은 글자를 줄인다 18 → 15 · 13 → 12)
// · 면접방 메시지(interview.stt: 확정 글 · 미확정 글, question started ~ ended · failed 동안 답변 잠금 — use-interview-room)

/** S06 화상: 내 답변 음성 인식 상자. 맨 아래 줄(children)에 파형 · [답변 완료]가 들어간다. */
export function AnswerCaption({
  status,
  confirmedText,
  interimText,
  locked = false,
  children,
}: {
  status: InterviewRoomStatus;
  confirmedText: string;
  interimText: string;
  /** 면접관이 질문을 말하는 중이라 답변을 받지 않는다(question started ~ ended · failed) */
  locked?: boolean;
  children?: ReactNode;
}) {
  const empty = !confirmedText && !interimText;
  return (
    <section
      aria-label="내 답변 음성 인식"
      className="flex w-full flex-col gap-2.5 rounded-[20px] border border-white/15 bg-white/8 px-[22px] py-4 tracking-[-0.2px] backdrop-blur-[16px]"
    >
      <p className="flex items-center gap-1.5 text-xs leading-normal font-bold text-white/70 sm:text-[13px]">
        <span
          aria-hidden
          className={`size-2 rounded-full bg-[#ff5a5a] ${locked ? "opacity-30" : ""}`}
        />
        {locked ? "내 답변" : "내 답변 · 듣는 중"}
      </p>
      <p
        aria-live="polite"
        aria-atomic="true"
        className="max-h-36 overflow-y-auto text-[15px] leading-normal font-medium break-words whitespace-pre-wrap text-white sm:text-lg"
      >
        {locked ? (
          <span className="text-white/50">질문이 끝나면 말씀해 주세요</span>
        ) : empty ? (
          <span className="text-white/50">
            {status === "idle" || status === "connecting"
              ? "음성 인식에 연결하고 있어요."
              : "말씀하신 내용이 여기에 표시돼요."}
          </span>
        ) : (
          <>
            {confirmedText}
            <span className="text-white/50">{interimText}</span>
          </>
        )}
      </p>
      {children}
    </section>
  );
}
