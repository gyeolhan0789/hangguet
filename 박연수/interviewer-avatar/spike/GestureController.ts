// 발췌: 끄덕임 곡선 (실행용 아님, 2026-10-14 변경분)
// 이전: sin² 두 봉우리(같은 크기, 매번 0까지 왕복) → 기계적으로 보임
// 변경: 빠르게 숙이고 천천히 올라오며, 두 번째는 55% 크기로 첫 번째가 다 돌아오기 전에 시작한다

/** start~peak 에서 0→1, peak~end 에서 1→0 (양쪽 smoothstep) */
function nodBump(p: number, start: number, peak: number, end: number): number {
  if (p <= start || p >= end) return 0;
  return p < peak
    ? smoothstep((p - start) / (peak - start))
    : 1 - smoothstep((p - peak) / (end - peak));
}

// gestureOffsetAt() 안 (p = 경과 시간 ÷ 0.8초)
//   case 'nod': {
//     const first = nodBump(p, 0, 0.2, 0.6);
//     const second = 0.55 * nodBump(p, 0.42, 0.62, 1);
//     return { headPitch: 10 * DEG * scale * (first + second), headRoll: 0, tilt: 0 };
//   }
