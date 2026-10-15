// 투명 배경 그림의 가장자리 테두리 제거 (생성 도구가 반투명 가장자리에 밝은 색을 섞어 둔 것)
// 1) 투명 영역에서의 거리(px)를 구하고  2) 가장자리 띠(BAND px)의 색을 안쪽(BAND+1~BAND+3 px) 색으로 바꾸고
// 3) 알파를 ERODE px 만큼 부드럽게 깎는다. 모든 표정 그림에 똑같이 적용해야 그림끼리 섞을 때 차이가 안 생긴다
export const BAND = 4, ERODE = 1.5;
export function defringe(data, W, H) {
  const N = W * H, INF = 1e9, d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = data[i * 4 + 3] < 128 ? 0 : INF;
  // 2-pass chamfer 거리 (1, √2)
  const r2 = Math.SQRT2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; let v = d[i]; if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 1); if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + r2); if (x < W - 1) v = Math.min(v, d[i - W + 1] + r2); } d[i] = v; }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; let v = d[i]; if (!v) continue;
    if (x < W - 1) v = Math.min(v, d[i + 1] + 1); if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + r2); if (x > 0) v = Math.min(v, d[i + W - 1] + r2); } d[i] = v; }
  const src = Uint8Array.from(data), R = BAND + 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, a = src[i * 4 + 3]; if (!a) continue;
    const di = d[i];
    if (di <= BAND) { let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
        for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const j = yy * W + xx;
          if (d[j] > BAND && d[j] <= BAND + 3) { r += src[j * 4]; g += src[j * 4 + 1]; b += src[j * 4 + 2]; n++; } } }
      if (n) { data[i * 4] = r / n; data[i * 4 + 1] = g / n; data[i * 4 + 2] = b / n; } }
    const t = Math.min(1, Math.max(0, (di - 0.5) / ERODE)); data[i * 4 + 3] = Math.round(a * t * t * (3 - 2 * t)); }
  return data;
}
