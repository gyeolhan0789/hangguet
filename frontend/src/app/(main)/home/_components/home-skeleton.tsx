const bone = "bg-surface";

/** Figma S02-1 Home Skeleton. withHeader면 헤더 자리까지 그린다(인트로가 화면 전체를 덮을 때). */
export function HomeSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return (
    <div aria-hidden className="flex w-full flex-col items-center gap-6 bg-bg pb-16">
      {withHeader && (
        <div className="flex h-18 w-full items-center justify-between border-b border-line px-5 sm:px-10">
          <span className={`h-7 w-24 rounded-[10px] ${bone}`} />
          <span className="flex items-center gap-6">
            <span className={`hidden h-5 w-8 rounded-[10px] sm:block ${bone}`} />
            <span className={`hidden h-5 w-16 rounded-[10px] sm:block ${bone}`} />
            <span className={`h-[34px] w-16 rounded-full ${bone}`} />
            <span className={`size-9 rounded-full ${bone}`} />
            <span className={`h-8 w-14 rounded-full ${bone}`} />
          </span>
        </div>
      )}
      <span className={`mt-9 size-18 rounded-full ${bone}`} />
      <span className={`h-24 w-60 rounded-[20px] ${bone}`} />
      <span className={`h-[26px] w-[340px] max-w-[80vw] rounded-[10px] ${bone}`} />
      <span className={`h-[34px] w-60 rounded-full ${bone}`} />
      <span className="flex gap-2 sm:gap-3.5">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className={`size-9 rounded-full sm:size-11 ${bone}`} />
        ))}
      </span>
      <span className={`h-16 w-full max-w-[440px] rounded-2xl ${bone}`} />
      <span className="grid w-full max-w-[1120px] gap-5 px-6 sm:grid-cols-2 lg:px-0">
        <span className={`h-[170px] rounded-3xl ${bone}`} />
        <span className={`h-[170px] rounded-3xl ${bone}`} />
      </span>
    </div>
  );
}
