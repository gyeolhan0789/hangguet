// 발췌: 2D 점 찍어 휘기(mesh warp) 렌더러 핵심 (실행용 아님)
// 준비(미리 1회): 그림마다 MediaPipe Face Landmarker로 얼굴 점 478개를 찾아 landmarks.json에 저장한다.
// 서비스에서는 이 JSON만 읽으므로 MediaPipe를 포함하지 않는다.

// 그림 13장 + 미세 표정 5장(18장판). 그룹별로 섞고, 그룹마다 움직일 수 있는 영역(마스크)이 다르다
const FRAMES = ['00_base', 'eyes_half', 'eyes_closed', 'mouth_small', 'mouth_wide', 'mouth_o',
  'smile_50', 'smile', 'frown', 'brows_up', 'smirk', 'stalk_small', 'stalk_wide' /* + sub_* 5장 */];
const GROUPS = {
  expr: ['smile_50', 'smile', 'frown', 'brows_up', 'smirk'], // 얼굴 전체
  eyes: ['eyes_half', 'eyes_closed'],                         // 눈 주변만
  mouth: ['mouth_small', 'mouth_wide', 'mouth_o', 'stalk_small', 'stalk_wide'], // 입~턱만
};

// 메시: 얼굴 점 468개(홍채 제외) + 머리 둘레 고정 28개 + 테두리 16개 → 들로네 삼각분할 약 1006개.
// 모든 그림의 평균 위치로 한 번만 나눈다(그림마다 삼각형 구성이 같아야 섞을 수 있다).

/** 1) 점 위치 계산: 기본 위치 + Σ 세기 × 그룹 마스크 × (그 그림의 점 − 기본 점), 그 뒤 고개 동작 */
function computeTargets(w) {
  const B = P['00_base']; tgt.set(B);
  for (const g in GROUPS) {
    const gm = masks.geoArr[g];
    for (const f of GROUPS[g]) {
      const wf = w[f]; if (!wf || !P[f]) continue; const Q = P[f];
      for (let i = 0; i < NV; i++) { const m = gm[i] * wf; if (!m) continue;
        tgt[2 * i] += m * (Q[2 * i] - B[2 * i]); tgt[2 * i + 1] += m * (Q[2 * i + 1] - B[2 * i + 1]); }
    }
  }
  // 고개: 목 아래 축 기준 갸웃(회전) + 끄덕임. 끄덕임은 위쪽(이마)일수록 더 내려가게 해 숙이는 느낌을 준다.
  // 머리 가중치 HEAD는 얼굴 1, 어깨·테두리 0 (몸은 고정)
  const ang = st.tilt * Math.PI / 180, [px, py] = masks.pivot, c = Math.cos(ang), s = Math.sin(ang);
  for (let i = 0; i < NV; i++) {
    const h = masks.HEAD[i]; if (!h) continue; const x = tgt[2 * i] - px, y = tgt[2 * i + 1] - py;
    const r = clamp(-y / (1.25 * masks.faceH), 0, 1.4), dy = st.nod * (0.3 + 0.9 * r);
    const rx = px + c * x - s * y, ry = py + s * x + c * y + dy;
    tgt[2 * i] += h * (rx - tgt[2 * i]); tgt[2 * i + 1] += h * (ry - tgt[2 * i + 1]);
  }
  return tgt;
}

/** 2) 그리기: 기본 그림을 목표 메시로 휘어 그리고, 그룹 순서(표정 → 눈 → 입)로 각 그림을 같은 메시에 휘어 덧그린다 */
function render(w) {
  const pos = computeTargets(w);
  drawFrame('00_base', 0, 1, 0, 0, 0, pos);
  const chanOf = { expr: 1, eyes: 2, mouth: 3 };
  for (const g of ['expr', 'eyes', 'mouth']) {
    const fs = GROUPS[g].filter((f) => texs[f] && w[f] > 0.002);
    let S = fs.reduce((a, f) => a + w[f], 0); const norm = S > 1 ? 1 / S : 1; S *= norm; let cum = 0;
    for (const f of fs) { const wv = w[f] * norm; cum += wv; drawFrame(f, chanOf[g], wv, S, cum, g === 'mouth' ? 1 : 0, pos); }
  }
}

// 3) 섞기 셰이더: 그룹 안에서는 정규화 크로스디졸브(그림 세기 합이 1을 넘지 않게), 그룹 마스크로 영역 제한.
// 입 안쪽(입술 안 삼각형)은 알파를 날카롭게 해 이빨이 반투명하게 겹치지 않고 교체되게 한다
const FS = `precision mediump float; varying vec2 vUv; varying vec4 vMask; uniform sampler2D uTex;
uniform int uChan; uniform float uW, uS, uCum, uInner;
void main(){
  float m = uChan==0 ? 1.0 : uChan==1 ? vMask.x : uChan==2 ? vMask.y : vMask.z;
  // 순차 정규화 크로스디졸브: 결과 = (1 - m*S)*이전 + m*Σ(w_k*그림_k)
  float a = uChan==0 ? 1.0 : (m*uW) / max(1.0 - m*uS + m*uCum, 1e-4);
  if (uInner > 0.0) { float sh = smoothstep(0.08, 0.35, a); a = mix(a, sh, smoothstep(0.2, 0.8, vMask.w) * uInner); }
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, a);
}`;
