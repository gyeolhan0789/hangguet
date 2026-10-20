import { bone, PracticeSkeleton } from "@/components/practice/practice-skeleton";

// S04가 지원서(4.2)를 불러오는 동안: 면접관 줄 세 개 자리
export function InterviewerSkeleton() {
  return (
    <PracticeSkeleton current={2} width="max-w-[760px]">
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className={`h-28 rounded-[20px] ${bone}`} />
        ))}
      </div>
    </PracticeSkeleton>
  );
}
