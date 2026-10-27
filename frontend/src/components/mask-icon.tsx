/**
 * Figma에서 내려받은 SVG 아이콘을 모양 그대로 쓰되, 색은 Tailwind 토큰(bg-*)으로 칠한다.
 * SVG에 박힌 색은 라이트 모드 값이라, 다크 모드에서 색이 바뀌어야 하는 아이콘에 쓴다.
 */
export function MaskIcon({
  src,
  size,
  width = size,
  height = size,
  className = "bg-current",
}: {
  src: string;
  /** 정사각형 아이콘 크기. 가로·세로가 다르면 width·height를 쓴다. */
  size?: number;
  width?: number;
  height?: number;
  /** 아이콘 색. 예: "bg-text-2" */
  className?: string;
}) {
  const mask = `url(${src}) center / contain no-repeat`;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={{ width, height, mask, WebkitMask: mask }}
    />
  );
}
