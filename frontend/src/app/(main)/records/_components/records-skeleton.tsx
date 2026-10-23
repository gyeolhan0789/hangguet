// 연습 기록이 3.3 달력 · 5.13 목록을 불러오는 동안. Figma에 로딩 화면이 없어 연습 기록 초안(232:843)과 같은 자리에
// S09처럼 회색 덩어리를 둔다. 기준: Figma 연습 기록 초안 배치 · S02 Home Skeleton 색(surface) · S09 MypageSkeleton
const bone = "bg-surface";

export function RecordsSkeleton() {
  return (
    <div aria-hidden className="mx-auto flex w-full max-w-[1152px] flex-col gap-6 px-4 pt-8 pb-16">
      <div className="flex items-center gap-2.5">
        <span className={`h-9 w-32 rounded-[10px] ${bone}`} />
        <span className={`h-[26px] w-16 rounded-full ${bone}`} />
      </div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <span className={`h-[672px] w-full shrink-0 rounded-3xl lg:w-[360px] ${bone}`} />
        <span className={`h-[320px] flex-1 rounded-3xl lg:h-[672px] ${bone}`} />
      </div>
    </div>
  );
}
