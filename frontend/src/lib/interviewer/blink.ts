import { easeInOut, easeOut, transform } from "motion";

// 기준: 사용자 요청(2026-11-06: 최적화 후 깜빡임 중간 동작을 포함한 전체 검수)
// · Motion transform 공식 문서: 시간 구간을 연속적인 숫자 가중치에 매핑한다.
export const BLINK_DURATION_MS = 160;

// 빠르게 감고 잠시 닫은 뒤 조금 더 천천히 뜬다. 닫힌 구간을 두어 표시 프레임 사이에서도 완전히 감긴다.
export const blinkAt = transform([0, 48, 80, BLINK_DURATION_MS], [0, 1, 1, 0], {
  ease: [easeInOut, easeInOut, easeOut],
});
