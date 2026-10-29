import Link from "next/link";

// 기준: Figma 지원 관리 · 목록(아래 '‹ 1 / 1 ›' — 화살표 18 Medium text-3 · 쪽수 15 SemiBold text-2 · 간격 16)
// 지원 관리 목록과 상세의 면접 기록(Swagger 4.6 page)이 같이 쓴다.

const pagerArrow =
  "rounded-md text-lg leading-normal font-medium text-text-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/** '‹ 1 / 3 ›'. page는 0부터, pathOf는 그 쪽의 주소. 처음 · 끝 쪽에서는 화살표를 누를 수 없다. */
export function ApplicationPager({
  page,
  totalPages,
  pathOf,
  scroll,
}: {
  page: number;
  totalPages: number;
  pathOf: (page: number) => string;
  /** false면 쪽을 넘길 때 스크롤을 그대로 둔다(상세의 면접 기록) */
  scroll?: boolean;
}) {
  return (
    <nav aria-label="페이지" className="flex w-full items-center justify-center gap-4">
      {page > 0 ? (
        <Link
          href={pathOf(page - 1)}
          scroll={scroll}
          aria-label="이전 페이지"
          className={pagerArrow}
        >
          ‹
        </Link>
      ) : (
        <span aria-hidden className={pagerArrow}>
          ‹
        </span>
      )}
      <span className="text-[15px] leading-normal font-semibold text-text-2">
        {page + 1} / {totalPages}
      </span>
      {page + 1 < totalPages ? (
        <Link
          href={pathOf(page + 1)}
          scroll={scroll}
          aria-label="다음 페이지"
          className={pagerArrow}
        >
          ›
        </Link>
      ) : (
        <span aria-hidden className={pagerArrow}>
          ›
        </span>
      )}
    </nav>
  );
}
