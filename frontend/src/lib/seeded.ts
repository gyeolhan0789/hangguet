/** 서버·클라이언트에서 같은 값이 나와야 하는 "랜덤" 값(0~1). 하이드레이션 불일치를 막는다. */
export function seeded(index: number, salt: number) {
  const x = Math.sin(index * 9301 + salt * 49297) * 233280;
  return x - Math.floor(x);
}
