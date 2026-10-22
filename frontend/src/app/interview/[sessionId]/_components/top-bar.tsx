"use client";

import { motion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { PERSONAS } from "@/lib/interview/personas";
import { formatElapsed, TOTAL_QUESTIONS } from "@/lib/interview/questions";
import { useInterviewStore } from "@/stores/interview-store";
import type { CurrentQuestion, SessionResponse } from "@/types/api";

// 기준: Figma S06 · S06-B 위 막대(18:2502 Persona Pill: 위 20 · 왼 24 · 반투명 rgba(14,16,22,.8) · blur 8 · 테두리 흰색 10%
// · Mark 24(brand-strong · 둥글기 7 · flame 14) · 면접관 15 Bold 흰색 · '○○전자 백엔드' 15 Medium 흰색 60%)
// · 18:2508 Progress Pill(360×44 · '질문 3 / 5' 15 Bold · 트랙 120×4 흰색 20% · 채움 brand · '08:42' 15 SemiBold 흰색 70%)
// · 18:2513 End Button(높이 44 · rgba(255,90,90,.15) · 테두리 rgba(255,90,90,.4) · phone-off 16 · '면접 종료' 15 Bold #ff8a8a)
// · Swagger 5.2(persona · companyName · jobTitle · currentQuestion.seq · answeredCount · elapsedSeconds · status)
// · API 명세 5.2(전체 질문 수 5 고정) · 모션 메모 S06(18:2569: [답변 완료] → 상단 진행 바 width 증가)
// · 기획 메모 S06-E(18:3508: [면접 종료] → 종료 확인) · 기획 메모 S06-F(18:3575: 멈춤 상태에서 타이머 정지)

const pill =
  "flex items-center rounded-full border border-white/10 bg-[rgba(14,16,22,0.8)] backdrop-blur-[8px]";

/** 면접관 표시 아이콘. Figma에는 악마 면접관(flame)만 있다. */
const MARK: Partial<Record<SessionResponse["persona"], string>> = {
  DEVIL: "/interview/icon-flame.svg",
};

export function TopBar({
  session,
  question,
}: {
  session: SessionResponse;
  /** 5.5 지금 질문. 다음 질문을 기다리는 중이면 null */
  question: CurrentQuestion | null;
}) {
  const openEnd = useInterviewStore((state) => state.openEnd);
  const persona = PERSONAS.find((info) => info.persona === session.persona);
  const mark = MARK[session.persona];
  // 질문을 기다리는 동안(currentQuestion 없음)은 마지막으로 답한 질문 번호를 둔다.
  const seq = Math.min(TOTAL_QUESTIONS, question?.seq ?? session.answeredCount);

  return (
    // 좁은 화면에서는 진행 표시가 두 번째 줄로 내려간다(Figma는 1440 폭 한 장뿐이다).
    <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 px-4 pt-5 md:px-6">
      <div className={`${pill} min-w-0 gap-2.5 px-4 py-2.5`}>
        {mark && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-brand-strong">
            <Image src={mark} alt="" width={14} height={14} />
          </span>
        )}
        <span className="text-[15px] leading-normal font-bold whitespace-nowrap text-white">
          {persona?.name}
        </span>
        <span className="hidden truncate text-[15px] leading-normal font-medium text-white/60 sm:inline">
          {session.companyName} {session.jobTitle}
        </span>
      </div>

      <div
        className={`${pill} order-last h-11 w-full justify-center gap-3.5 px-[18px] md:absolute md:top-5 md:left-1/2 md:order-none md:w-[360px] md:-translate-x-1/2`}
      >
        <ProgressPill seq={seq} />
        <Elapsed seconds={session.elapsedSeconds} running={session.status === "IN_PROGRESS"} />
      </div>

      <button
        type="button"
        onClick={openEnd}
        // Figma End Button은 오른쪽 끝에서 37(내 카메라보다 13 안쪽)이다.
        className="flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full md:mr-[13px] border border-[rgba(255,90,90,0.4)] bg-[rgba(255,90,90,0.15)] px-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff8a8a]"
      >
        <Image src="/interview/icon-phone-off.svg" alt="" width={16} height={16} />
        <span className="text-[15px] leading-normal font-bold whitespace-nowrap text-[#ff8a8a]">
          면접 종료
        </span>
      </button>
    </div>
  );
}

/** '질문 3 / 5'와 진행 막대. 질문이 바뀌면 막대가 늘어난다. */
function ProgressPill({ seq }: { seq: number }) {
  return (
    <>
      <span className="text-[15px] leading-normal font-bold whitespace-nowrap text-white">
        질문 {seq} / {TOTAL_QUESTIONS}
      </span>
      <span
        role="progressbar"
        aria-label="질문 진행"
        aria-valuemin={0}
        aria-valuemax={TOTAL_QUESTIONS}
        aria-valuenow={seq}
        className="relative h-1 w-[120px] shrink-0 overflow-hidden rounded-full bg-white/20"
      >
        <motion.span
          className="absolute inset-y-0 left-0 rounded-full bg-brand"
          initial={false}
          animate={{ width: `${(seq / TOTAL_QUESTIONS) * 100}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </span>
    </>
  );
}

/** 면접 경과 시간. 5.2 elapsedSeconds에서 시작해 면접 중(IN_PROGRESS)에만 1초마다 는다. */
function Elapsed({ seconds, running }: { seconds: number; running: boolean }) {
  // 다시 그려 5.2 값이 바뀌면 그 값에서 다시 센다.
  const [base, setBase] = useState(seconds);
  const [extra, setExtra] = useState(0);
  if (base !== seconds) {
    setBase(seconds);
    setExtra(0);
  }

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setExtra((now) => now + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <time className="text-[15px] leading-normal font-semibold text-white/70">
      {formatElapsed(base + extra)}
    </time>
  );
}
