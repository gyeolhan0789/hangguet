// 발췌: 2D 점 찍어 휘기 렌더러의 움직임 층 (실행용 아님)
// 입력: 표현 모듈이 매 프레임 내는 값(표정 세기·깜빡임·입 벌림·고개) → 출력: 그림 섞기 세기와 점 이동

// 1) 시간 보간: 채널별 임계 감쇠 스프링. 1/480초 단위로 계산해 화면 주사율과 관계없이 같은 곡선을 낸다
const SMOOTH_W = { smile: 14, smirk: 14, frown: 14, brows: 12, blink: 0, open: 55, nod: 22, tilt: 18 }; // 각진동수(rad/s), 0 = 그대로
const SUB = 1 / 480;
function smoothStep(target, now, zetas = null) {
  const dt = smLast === null ? 0 : Math.min(0.1, (now - smLast) / 1000); smLast = now;
  for (const k in SMOOTH_W) {
    const x = target[k] ?? 0; if (!sm[k]) sm[k] = { v: x, d: 0 }; const s = sm[k], w = SMOOTH_W[k];
    if (!w) { s.v = x; s.d = 0; continue; }
    const z = zetas?.[k] ?? 1; // 1 = 지나침 없음, 1 미만이면 목표를 살짝 지났다 돌아온다
    for (let t = 0; t < dt; t += SUB) { const h = Math.min(SUB, dt - t); const a = w * w * (x - s.v) - 2 * z * w * s.d; s.d += a * h; s.v += s.d * h; }
  }
  return Object.fromEntries(Object.keys(SMOOTH_W).map((k) => [k, sm[k].v]));
}

// 2) 애니메이션 원칙: 채널마다 조금씩 늦게 내보내고(시차), 그 사이 미리 보이는 변화로 예고 동작을 만든다
const ANIM_DELAY = { brows: 0.05, nod: 0.08, tilt: 0.09, smile: 0.11, smirk: 0.11, frown: 0.11, blink: 0, open: 0 }; // 입은 음성과 맞춰야 해서 늦추지 않음
const ANIM_ZETA = { smile: 0.72, smirk: 0.72, frown: 0.72, brows: 0.7, nod: 0.8, tilt: 0.65 };                     // 지나침·안착
const ANIM = { headAnti: 0.12, browFlash: 0.35, liftPx: 1.6, blinkChange: 0.25, blinkGap: 1.5, blinkMs: 220 };
function animate(target, now) {
  const t = now / 1000, out = {}, ahead = {};
  for (const k in ANIM_DELAY) { out[k] = sampleAt(t - ANIM_DELAY[k], k); ahead[k] = (target[k] ?? 0) - out[k]; } // ahead = 곧 일어날 변화
  out.nod -= ANIM.headAnti * ahead.nod; out.tilt -= ANIM.headAnti * ahead.tilt;      // 고개: 움직이기 직전 반대쪽으로 살짝
  const rise = Math.max(0, ahead.smile) + Math.max(0, ahead.smirk);
  out.brows += ANIM.browFlash * rise; out.nod -= ANIM.liftPx * rise;                 // 미소 직전 눈썹이 먼저 올라가고 고개가 들림
  const change = Math.abs(ahead.smile) + Math.abs(ahead.smirk) + Math.abs(ahead.frown);
  if (change > ANIM.blinkChange && now - changeBlinkAt > ANIM.blinkGap * 1000) changeBlinkAt = now; // 표정이 크게 바뀔 때 깜빡임
  return out;
}

// 3) 말할 때 윗얼굴·입꼬리 동작 (실사 시험 기준. 블라인드 비교에서 "괜찮음"을 받은 2 + 3 조합)
//    - 강세(음량의 느린 변화)에 맞춰 눈썹을 살짝 올림
//    - 입꼬리: 좌우 다른 박자로 살짝 올라가고, 강세에서 바깥으로
//    - 2: 0.6초 이상 말하다 끊기면 짧게 끄덕이고 0.7초 동안 움직임을 줄임(숨 고르기)
//    - 3: 질문 끝 0.9초 전부터 눈썹을 올림(qEnd = 질문 글 끝맺음 + 음성 길이로 계산). 질문 끝 근처 깜빡임은 막는다
const SPEECH_MOTION = { follow: 6, brows: 0.22, nodPx: 2.4, tiltDeg: 0.9, swayHz: 0.23, cornerPx: 3.2, cornerHz: [0.37, 0.29], cornerOutPx: 3.0 };
function speechMotion(t, now, dt) {
  spEnv += ((t.open || 0) - spEnv) * (1 - Math.exp(-SPEECH_MOTION.follow * dt));          // 강세
  if (spEnv > 0.12) { spSince += dt; spPeak = 1; } else if (spPeak && spEnv < 0.05) { if (spSince > 0.6) phraseAt = now; spPeak = 0; spSince = 0; }
  const pt = (now - phraseAt) / 1000, pause = pt >= 0 && pt < 0.7 ? Math.sin(Math.PI * pt / 0.7) : 0;
  spOn += ((spEnv > 0.06 ? 1 : 0) - spOn) * (1 - Math.exp(-2.5 * dt));
  const live = spOn * (1 - 0.8 * pause), ts = now / 1000;
  const osc = (hz, ph) => Math.sin(ts * 2 * Math.PI * hz + ph);
  const nodPause = 2.6 * (pt >= 0 && pt < 0.55 ? (pt < 0.15 ? pt / 0.15 : 1 - (pt - 0.15) / 0.4) : 0); // 빠르게 숙이고 천천히 복귀
  const q = t.qEnd || 0;
  return {
    ...t,
    brows: clamp((t.brows || 0) + SPEECH_MOTION.brows * spEnv * (1 - 0.5 * pause) + 0.38 * q),
    nod: (t.nod || 0) + SPEECH_MOTION.nodPx * spEnv + nodPause - 1.2 * q,
    tilt: (t.tilt || 0) + SPEECH_MOTION.tiltDeg * (osc(SPEECH_MOTION.swayHz, 0) * 0.7 + osc(SPEECH_MOTION.swayHz * 2.3, 1.3) * 0.3) * live,
    cornerL: SPEECH_MOTION.cornerPx * live * (0.45 + 0.55 * osc(SPEECH_MOTION.cornerHz[0], 0)),
    cornerR: SPEECH_MOTION.cornerPx * live * (0.45 + 0.55 * osc(SPEECH_MOTION.cornerHz[1], 1.9)),
    cornerOut: SPEECH_MOTION.cornerOutPx * spEnv,
  };
}
// 입꼬리(cornerL/R/Out)는 그림 없이 입꼬리 점(61·291) 주변을 가우스 가중치(입 폭의 약 1/4 반경)로 옮겨 만든다.

// 4) 2D 끄덕임 상한: 그림 한 장을 휘는 방식이라 크게 숙이면 얼굴이 머리카락 안에서 미끄러져 보인다
const NOD_MAX_PX = 8; // 1254px 그림 기준
const limitNod = (nod) => NOD_MAX_PX * Math.tanh(nod / NOD_MAX_PX);
