import { bone, PracticeSkeleton } from "@/components/practice/practice-skeleton";

// S05-1이 지원서(4.2)를 불러오는 동안: 면접 방식 카드 두 개 자리
export function ModeSkeleton() {
  return (
    <PracticeSkeleton current={3} width="max-w-[800px]">
      <div className="grid gap-5 sm:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <span key={i} className={`h-[282px] rounded-3xl ${bone}`} />
        ))}
      </div>
    </PracticeSkeleton>
  );
}
