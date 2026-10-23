"use client";

import type { InterviewRoomStatus } from "@/components/interview/use-interview-room";

// 기준: 사용자 승인 면접 화면 STT 텍스트 표시. 기존 S06 질문 말풍선의 색·테두리를 재사용한다.
export function AnswerCaption({
  status,
  confirmedText,
  interimText,
  onRetry,
}: {
  status: InterviewRoomStatus;
  confirmedText: string;
  interimText: string;
  onRetry: () => void;
}) {
  return (
    <section
      aria-label="내 답변 음성 인식"
      className="w-full rounded-[20px] border border-white/10 bg-[rgba(14,16,22,0.8)] px-[22px] py-[18px] text-sm text-white backdrop-blur-[8px]"
    >
      <p className="mb-2 font-bold text-white/70">내 답변</p>
      <p
        aria-live="polite"
        aria-atomic="true"
        className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-base leading-relaxed"
      >
        {confirmedText}
        <span className="text-white/50">{interimText}</span>
      </p>
      {(status === "idle" || status === "connecting" || status === "reconnecting") && (
        <p role="status" className="text-white/60">
          {status === "reconnecting"
            ? "음성 인식에 다시 연결하고 있어요."
            : "음성 인식에 연결하고 있어요."}
        </p>
      )}
      {status === "listening" && !confirmedText && !interimText && (
        <p className="text-white/60">말씀하신 내용이 여기에 표시돼요.</p>
      )}
      {(status === "failed" || status === "sttFailed") && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[#ff8a8a]">
          <p>음성 인식에 연결하지 못했어요.</p>
          {status === "failed" && (
            <button
              type="button"
              onClick={onRetry}
              className="font-bold text-brand underline underline-offset-4"
            >
              다시 연결
            </button>
          )}
        </div>
      )}
    </section>
  );
}
