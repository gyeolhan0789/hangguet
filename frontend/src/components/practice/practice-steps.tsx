import Image from "next/image";

// 기준: Figma S03 Stepper(18:2052, 진행 중인 단계) · S04 Stepper(18:2141, 끝난 단계: 체크 + 주황 연결선)

/** 연습 시작 5단계: S03 지원서 → S04 면접관 선택 → S05-1 면접 방식 → S06 장치 점검 → 면접 */
export const PRACTICE_STEPS = ["지원서", "면접관 선택", "면접 방식", "장치 점검", "면접"] as const;

export type PracticeStep = 1 | 2 | 3 | 4 | 5;

/** 단계 이름 글자: 지금 단계는 진하게, 나머지는 넓은 화면에서만 보이고 끝난 단계가 아직 안 한 단계보다 진하다 */
function stepLabelTone(active: boolean, done: boolean): string {
  if (active) return "font-extrabold text-text-1";
  return done
    ? "hidden font-semibold sm:inline text-text-2"
    : "hidden font-semibold sm:inline text-text-3";
}

/** 연습 시작 단계 표시. current는 지금 화면의 단계(1부터) */
export function PracticeSteps({ current }: Readonly<{ current: PracticeStep }>) {
  return (
    <ol aria-label="면접 준비 단계" className="flex items-center gap-2.5">
      {PRACTICE_STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className="flex items-center gap-2.5"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={`h-0.5 w-4 shrink-0 rounded-full sm:w-7 ${step <= current ? "bg-brand" : "bg-line"}`}
              />
            )}
            <span className="flex items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] leading-normal font-extrabold tracking-[-0.2px] ${
                  done || active ? "bg-brand-strong text-white" : "bg-surface text-text-3"
                }`}
              >
                {done ? (
                  <Image src="/practice/icon-check.svg" alt="" width={16} height={16} />
                ) : (
                  step
                )}
              </span>
              <span
                className={`text-[15px] leading-normal tracking-[-0.2px] whitespace-nowrap ${stepLabelTone(active, done)}`}
              >
                {label}
                {done && <span className="sr-only"> 완료</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
