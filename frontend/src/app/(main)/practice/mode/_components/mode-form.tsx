"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { PracticeActionBar, PracticeNextButton } from "@/components/practice/practice-action-bar";
import { PracticeSteps } from "@/components/practice/practice-steps";
import { createSession } from "@/lib/interview/actions";
import { modeInfo } from "@/lib/interview/modes";
import { groupNewPath, interviewerPath } from "@/lib/routes";
import type { Mode, Persona } from "@/types/api";

import { ModeCards } from "./mode-cards";
import { TogetherOption } from "./together-option";

// 기준: Figma S05-1 면접 방식 선택(18:2219: 제목 · '면접관 · 회사 직무' 줄 · 카드 두 개 · [← 면접관 선택] · [다음])
// · 기획 메모 S05-1([다음] 문구: 화상 '다음: 장치 점검' · 채팅 '면접 시작', [다음]을 누를 때 면접 플랜 생성 시작)
// · 모션 메모 S05-1([다음] 문구가 선택에 따라 crossfade) · Swagger 5.1 면접 만들기(Idempotency-Key)
// · Figma [초안] S05-1 함께 보기(488:2510: '친구와 함께 볼래요'를 켜면 [다음: 그룹 만들기] → G02, 면접은 그룹을 만들 때 만든다(BE 10.1))

export function ModeForm({
  applicationId,
  persona,
  subtitle,
}: Readonly<{
  applicationId: number;
  persona: Persona;
  /** "악마 면접관 · ○○전자 백엔드 개발자" */
  subtitle: string;
}>) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [together, setTogether] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [pending, startTransition] = useTransition();
  // 5.1 멱등 키: 같은 선택으로 다시 보내면 같은 키(면접이 두 번 만들어지지 않음), 방식을 바꾸면 다른 키(본문이 달라짐).
  // 지원서 · 면접관이 바뀌면 이 폼은 새로 그려지므로(page의 key) 키도 새로 만들어진다.
  const [idempotencyKeys, setIdempotencyKeys] = useState<Record<Mode, string>>(() => ({
    VIDEO: crypto.randomUUID(),
    CHAT: crypto.randomUUID(),
  }));

  // 아직 고르지 않았으면 Figma 기본 문구(화상)를 보여 준다.
  const nextLabel = together ? "다음: 그룹 만들기" : modeInfo(mode ?? "VIDEO").nextLabel;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode || pending) return;
    // 함께 보기: 면접은 G02에서 그룹을 만들 때(10.1) 함께 만든다. 여기서는 고른 값만 들고 간다.
    if (together) {
      router.push(groupNewPath(applicationId, persona, mode));
      return;
    }
    setFormError(undefined);
    startTransition(async () => {
      const result = await createSession({ applicationId, persona, mode }, idempotencyKeys[mode]);
      if (result.formError) setFormError(result.formError);
      // 서버가 실패로 답했으면 다음에 다시 누를 때는 새 키로 보낸다(같은 키·같은 본문이면 처음 결과를 그대로 반환).
      if (result.keySpent) {
        setIdempotencyKeys((keys) => ({ ...keys, [mode]: crypto.randomUUID() }));
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
        <PracticeSteps current={3} />

        <div className="flex w-full max-w-[800px] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-[32px] leading-[1.3] font-extrabold tracking-[-0.8px] text-text-1">
              어떻게 면접 볼까요?
            </h1>
            <p className="text-[17px] leading-normal font-medium tracking-[-0.2px] text-text-2">
              {subtitle}
            </p>
          </div>

          <ModeCards selected={mode} onSelect={setMode} />
          <TogetherOption checked={together} onChange={setTogether} />

          <AnimatePresence initial={false}>
            {formError && (
              <motion.p
                key={formError}
                role="alert"
                className="text-sm leading-normal font-semibold text-danger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
              >
                {formError}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <PracticeActionBar backHref={interviewerPath(applicationId, persona)} backLabel="면접관 선택">
        <PracticeNextButton disabled={mode === null} pending={pending}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={nextLabel}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {nextLabel}
            </motion.span>
          </AnimatePresence>
        </PracticeNextButton>
      </PracticeActionBar>
    </form>
  );
}
