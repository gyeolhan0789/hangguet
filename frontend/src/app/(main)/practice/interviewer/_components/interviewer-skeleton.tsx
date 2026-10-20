import { PracticeSteps } from "@/components/practice/practice-steps";

const bone = "bg-surface";

// 지원서(4.2)를 불러오는 동안. Figma에는 S04 로딩 화면이 없어, S04와 같은 자리에 S02 스켈레톤처럼 회색 덩어리를 둔다.
export function InterviewerSkeleton() {
  return (
    <div aria-hidden className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
      <PracticeSteps current={2} />
      <div className="flex w-full max-w-[760px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className={`h-[42px] w-[340px] max-w-full rounded-[10px] ${bone}`} />
          <span className={`h-[26px] w-[220px] max-w-full rounded-[10px] ${bone}`} />
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <span key={i} className={`h-28 rounded-[20px] ${bone}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
