import { bone } from "@/components/practice/practice-skeleton";
import { PracticeSteps } from "@/components/practice/practice-steps";

// 기준: Figma S05(18:2333) 배치 · S02 Home Skeleton 색
// S05가 면접(5.2)을 불러오는 동안. Figma에 로딩 화면이 없어 S05와 같은 자리(미리보기 · 제목 · 체크 줄 4개 · 준비 줄)에
// 다른 단계 화면처럼 회색 덩어리를 둔다. 제목이 오른쪽 열에 있어 공통 PracticeSkeleton 대신 따로 그린다.
export function DevicesSkeleton() {
  return (
    <div aria-hidden className="flex flex-1 flex-col items-center gap-8 px-4 pt-8 pb-10">
      <PracticeSteps current={4} />
      <div className="flex w-full max-w-[1040px] flex-col gap-8 lg:flex-row lg:items-start">
        <span
          className={`aspect-[600/430] w-full shrink-0 rounded-3xl lg:aspect-auto lg:h-[430px] lg:w-[600px] ${bone}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1.5 pb-2">
            <span className={`h-[39px] w-[300px] max-w-full rounded-[10px] ${bone}`} />
            <span className={`h-6 w-[240px] max-w-full rounded-[10px] ${bone}`} />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <span key={i} className={`h-[75px] rounded-2xl ${bone}`} />
          ))}
          <span className={`h-[67px] rounded-2xl ${bone}`} />
        </div>
      </div>
    </div>
  );
}
