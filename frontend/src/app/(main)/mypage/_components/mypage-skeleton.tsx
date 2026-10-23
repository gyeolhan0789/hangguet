// S09가 내 정보(2.1) · 통계(3.2) · 연습 달력(3.3) · 내 스트릭 유지권(8.13)을 불러오는 동안. Figma에 로딩 화면이 없어 S09와 같은 자리에
// S02 Home Skeleton처럼 회색 덩어리를 둔다. 기준: Figma S09(18:2848) 배치 · S02 Home Skeleton 색(surface)
const bone = "bg-surface";

export function MypageSkeleton() {
  return (
    <div
      aria-hidden
      className="mx-auto flex w-full max-w-[1152px] flex-col gap-[22px] px-4 pt-8 pb-10"
    >
      <div className="flex items-center gap-5">
        <span className={`size-[104px] shrink-0 rounded-full ${bone}`} />
        <div className="flex flex-col gap-1.5">
          <span className={`h-[42px] w-40 rounded-[10px] ${bone}`} />
          <span className={`h-[22px] w-64 max-w-full rounded-[10px] ${bone}`} />
          <span className={`h-[26px] w-28 rounded-full ${bone}`} />
        </div>
      </div>
      <span className={`h-[30px] w-12 rounded-[10px] ${bone}`} />
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className={`h-[156px] rounded-[20px] ${bone}`} />
        ))}
      </div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <span className={`h-[400px] w-full shrink-0 rounded-3xl lg:w-[560px] ${bone}`} />
        <span className={`h-[400px] flex-1 rounded-3xl ${bone}`} />
      </div>
      <span className={`h-[90px] rounded-[20px] ${bone}`} />
    </div>
  );
}
