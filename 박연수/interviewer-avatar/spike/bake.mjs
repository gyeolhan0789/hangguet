// usage: SHARP_FROM=<sharp 가 설치된 폴더> node bake.mjs <webDir>   (convert.mjs 다음에 실행)
// 눈 · 입 그림을 "부위 조각"으로 만든다: 그림의 투명도(alpha)를 겹칠 영역으로 바꿔서 표정 그림 위에 그대로 얹는다.
// - 눈: 그 그림이 기본 그림과 실제로 달라지는 곳(눈꺼풀)만 남긴다. 눈썹을 올린 · 내린 표정 위에 겹쳐도 기본 눈썹이 덮이지 않는다
// - 입: 입 그림 + 표정 그림(미소 · 히죽 · 찌푸림)이 입 주변에서 달라지는 곳을 모두 덮는다. 표정 그림의 입꼬리가 남아 입이 두 겹으로 보이지 않는다
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(path.join(process.env.SHARP_FROM, 'node_modules') + '/');
const sharp = require('sharp');
const [dir] = process.argv.slice(2);
const N = 768;

const EYES = ['eyes_25', '01_eyes_half', 'eyes_75', '02_eyes_closed'];
const MOUTHS = [
  'mouth_tiny',
  '03_mouth_small',
  'mouth_mid',
  '04_mouth_wide',
  'mouth_o',
  'smile_talk_tiny',
  'smile_talk_small',
  'smile_talk_mid',
  'smile_talk_wide',
];
const MOUTH_AREA_FROM = [
  ...MOUTHS,
  ...['smile_33', 'smile_66', '05_smile', 'smirk_50', 'smirk', 'frown_33', 'frown_66', '06_frown'],
];
// 영역(그림 대비 %). 눈은 눈썹 아래부터
const EYE_ZONE = { x: [33, 67], y: [38, 45] };
const MOUTH_ZONE = { x: [36, 66], y: [52, 72] };
const DIFF = 75; // RGB 차이 합이 이보다 크면 "달라진 픽셀"

// 파일을 버퍼로 읽는다(Windows 에서 sharp 가 연 파일에 다시 쓰지 못하는 문제)
const load = async (n) =>
  sharp(fs.readFileSync(path.join(dir, n + '.webp')))
    .ensureAlpha()
    .raw()
    .toBuffer();

function diffInto(m, a, b, zone) {
  for (let y = Math.floor((zone.y[0] * N) / 100); y < (zone.y[1] * N) / 100; y++)
    for (let x = Math.floor((zone.x[0] * N) / 100); x < (zone.x[1] * N) / 100; x++) {
      const i = (y * N + x) * 4;
      const s =
        Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (s > DIFF) m[y * N + x] = 1;
    }
}

function box(a, r) {
  const t = new Float32Array(N * N);
  const o = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    let acc = 0;
    for (let x = -r; x < N + r; x++) {
      if (x + r >= 0 && x + r < N) acc += a[y * N + x + r];
      if (x - r - 1 >= 0 && x - r - 1 < N) acc -= a[y * N + x - r - 1];
      if (x >= 0 && x < N) t[y * N + x] = acc / (2 * r + 1);
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let y = -r; y < N + r; y++) {
      if (y + r >= 0 && y + r < N) acc += t[(y + r) * N + x];
      if (y - r - 1 >= 0 && y - r - 1 < N) acc -= t[(y - r - 1) * N + x];
      if (y >= 0 && y < N) o[y * N + x] = acc / (2 * r + 1);
    }
  }
  return o;
}

/** 넓히기(흐린 뒤 문턱) → 부드러운 가장자리 */
function soften(m, grow, feather) {
  let g = box(m, grow);
  for (let i = 0; i < g.length; i++) g[i] = g[i] > 0.06 ? 1 : 0;
  const r = Math.max(1, feather >> 1);
  g = box(box(g, r), r);
  return Uint8Array.from(g, (v) => Math.round(Math.min(1, v * 1.25) * 255));
}

async function bake(name, alpha) {
  const px = await load(name);
  for (let i = 0; i < N * N; i++) px[i * 4 + 3] = Math.round((px[i * 4 + 3] * alpha[i]) / 255);
  await sharp(px, { raw: { width: N, height: N, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 90 })
    .toFile(path.join(dir, name + '.webp'));
}

const base = await load('00_base');
for (const n of EYES) {
  const m = new Float32Array(N * N);
  diffInto(m, await load(n), base, EYE_ZONE);
  await bake(n, soften(m, 3, 4));
}
const mouthArea = new Float32Array(N * N);
for (const n of MOUTH_AREA_FROM) diffInto(mouthArea, await load(n), base, MOUTH_ZONE);
const mouthAlpha = soften(mouthArea, 8, 14);
for (const n of MOUTHS) await bake(n, mouthAlpha);
console.log('ok', EYES.length + MOUTHS.length);
