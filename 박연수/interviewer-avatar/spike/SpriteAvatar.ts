// 2D 그림 면접관 렌더러 (renderer 'sprite2d', decisions.md MVP 2D).
// AvatarBrain 이 매 프레임 만드는 AvatarFrame 을 그대로 받아 표정 그림을 바꿔 끼운다.
// - 표정: 논리 표정 세기 중 가장 큰 것 하나 → 단계 그림(기본 → 1/3 → 2/3 → 완전), 한 장씩 stepMs 간격으로 거쳐 간다.
//   다른 표정으로 갈 때는 기본 얼굴까지 되돌아갔다가 간다
// - 눈: blink(0~1) → 5단계(뜬 눈 = 표정 그림, 1/4 · 반 · 3/4 · 감음), 눈 부위 마스크로 표정 그림 위에 겹친다
// - 입: MouthController 출력(0~1, 이미 보간됨) → 5단계(다묾 = 표정 그림, 아주 살짝 · 조금 · 중간 · 크게) + 오/우,
//   입 부위 마스크(또는 부위 조각 그림)로 겹친다. 웃는 얼굴이면 웃으며 말하는 입(expressionMouth)
// - 끄덕임 · 갸웃 · 상태 자세 · 호흡: 고개 pitch/roll → 그림 전체의 작은 translate/rotate
// 구현은 DOM <img> 겹치기 (그림 25장을 미리 로드하고 opacity 만 바꾼다. 매 프레임 그리기 없음)
import type { AvatarFrame } from './controllers/AvatarBrain.ts';
import type { ExpressionLevels } from './controllers/ExpressionController.ts';
import { DEG, clamp } from './controllers/math.ts';
import type { SpriteConfig, SpriteExpression, SpriteMask } from './personas.ts';

/** 그림 로드 Timeout (GLB 와 같은 10초, decisions.md ③-3) */
export const SPRITE_LOAD_TIMEOUT_MS = 10_000;
/** 표정 그림이 바뀔 때 새 그림이 위에서 나타나는 시간(ms). 이전 그림은 그동안 아래에 남는다 */
export const SPRITE_FADE_MS = 90;
/** 로드 후 decode() 를 기다리는 최대 시간(ms) */
const DECODE_WAIT_MS = 300;
const MAX_DELTA_SEC = 0.1;

// requestAnimationFrame 이 없는 환경(일부 테스트 환경)에서는 16ms 타이머로 대신한다
const nextFrame = (cb: (t: number) => void): number =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(() => cb(performance.now()), 16) as unknown as number);
const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
};

/** 같은 세기면 앞쪽이 이긴다 (순간 표정 우선) */
export const SPRITE_EXPRESSIONS: readonly SpriteExpression[] = ['smirk', 'smile', 'frown', 'brows'];

/** 그릴 표정 그림 단계. group null 또는 level 0 이면 기본 얼굴 */
export interface SpriteTarget {
  group: SpriteExpression | null;
  /** 0 = 기본, 1.. = 표정 단계 (config.expressions[group][level - 1]) */
  level: number;
}

const BASE_TARGET: SpriteTarget = { group: null, level: 0 };

/** 기본 ↔ 1단계 경계의 여유(단계 단위). 경계 ±0.15 단계 안에서는 지금 그림을 유지한다 */
export const SPRITE_LEVEL_HYSTERESIS = 0.15;

/** 논리 표정 세기 → 그림 그룹별 세기. 관심(태도)과 갸웃 눈썹은 같은 '눈썹 올림' 그림을 쓴다 */
export function spriteGroupLevels(levels: ExpressionLevels): Record<SpriteExpression, number> {
  return {
    smirk: levels.smirk ?? 0,
    smile: levels.smile ?? 0,
    frown: levels.frown ?? 0,
    brows: Math.max(levels.interest ?? 0, levels.tilt ?? 0),
  };
}

/**
 * 가장 큰 표정 하나와 강도 구간으로 그림 단계를 고른다.
 * 단계가 3장이면 세기 0 · 1/3 · 2/3 · 1 중 가장 가까운 단계(히죽은 2장이라 0 · 1/2 · 1)
 */
export function pickSpriteTarget(
  levels: ExpressionLevels,
  config: Pick<SpriteConfig, 'expressions' | 'minExpressionLevel'>,
  prev?: SpriteTarget,
): SpriteTarget {
  const by = spriteGroupLevels(levels);
  let group: SpriteExpression | null = null;
  let value = 0;
  for (const g of SPRITE_EXPRESSIONS) {
    if (by[g] > value) {
      group = g;
      value = by[g];
    }
  }
  if (group === null) return BASE_TARGET;
  const steps = config.expressions[group].length;
  const raw = value < config.minExpressionLevel ? 0 : clamp(value, 0, 1) * steps;
  // 태도(관심) 값이 기본 ↔ 1단계 경계에서 조금씩 흔들려도 그림이 깜빡이지 않게 그 경계에만 여유를 둔다.
  // (위 단계 경계에는 두지 않는다. 순간 표정 세기 상한이 경계 바로 위라 완전한 표정에 못 닿을 수 있다)
  const H = SPRITE_LEVEL_HYSTERESIS;
  if (prev?.level === 0 && raw < 0.5 + H) return BASE_TARGET;
  if (prev?.level === 1 && prev.group === group && raw >= 0.5 - H && raw < 1.5) return prev;
  const level = Math.round(raw);
  return level <= 0 ? BASE_TARGET : { group, level: Math.min(level, steps) };
}

/**
 * 표정 단계 전환기. 목표가 바뀌면 그림을 한 장씩 stepMs 간격으로 거쳐 간다(첫 장은 바로).
 * 다른 표정으로 갈 때는 지금 표정 → 기본 → 새 표정 순서.
 */
export class ExpressionStepper {
  group: SpriteExpression | null = null;
  level = 0;
  private acc: number;

  constructor(private readonly stepMs: number) {
    this.acc = stepMs;
  }

  get target(): SpriteTarget {
    return { group: this.level === 0 ? null : this.group, level: this.level };
  }

  private reached(t: SpriteTarget): boolean {
    if (t.level === 0 || t.group === null) return this.level === 0;
    return this.group === t.group && this.level === t.level;
  }

  /** dtMs 만큼 시간을 보내고, 한 단계 움직였으면 true */
  update(dtMs: number, t: SpriteTarget): boolean {
    if (this.reached(t)) {
      // 다음 변화의 첫 장은 바로 보이도록 준비 상태 유지
      this.acc = Math.min(this.stepMs, this.acc + dtMs);
      return false;
    }
    this.acc += dtMs;
    if (this.acc < this.stepMs) return false;
    this.acc = 0;
    const wantLevel = t.group === null ? 0 : t.level;
    if (this.level > 0 && this.group !== t.group) {
      // 다른 표정이면 먼저 기본 얼굴 쪽으로 되돌아간다
      this.level -= 1;
    } else {
      if (this.level === 0) this.group = t.group;
      this.level += Math.sign(wantLevel - this.level);
    }
    if (this.level === 0) this.group = null;
    return true;
  }
}

/** blink(0~1) → 눈 단계 그림 번호. -1 이면 표정 그림의 눈(뜬 눈) 그대로 */
export function eyeFrameIndex(blink: number, count: number): number {
  return Math.round(clamp(blink, 0, 1) * count) - 1;
}

/**
 * 입 그림. null 이면 표정 그림의 입(다문 입) 그대로.
 * jawOpen: MouthController 출력(0~1). visemes: HeadAudio 립싱크일 때 viseme_* 값(가장 큰 것이 O/U 면 오므린 입)
 */
export function mouthFrame(
  jawOpen: number,
  visemes: Record<string, number>,
  config: Pick<SpriteConfig, 'mouth' | 'mouthRound' | 'mouthThresholds'>,
): string | null {
  let open = clamp(jawOpen, 0, 1);
  let top = '';
  let topV = 0;
  for (const [name, v] of Object.entries(visemes)) {
    if (v > topV) {
      top = name;
      topV = v;
    }
  }
  const [closed] = config.mouthThresholds;
  if (topV >= closed && (top === 'viseme_O' || top === 'viseme_U')) return config.mouthRound;
  open = Math.max(open, clamp(topV, 0, 1));
  const step = config.mouthThresholds.filter((t) => open >= t).length;
  return step === 0 ? null : (config.mouth[step - 1] ?? null);
}

/** 지금 보이는 표정 그림에 맞는 말하는 입 목록 (웃는 얼굴이면 웃으며 말하는 입) */
export function mouthSetFor(
  config: Pick<SpriteConfig, 'mouth' | 'expressionMouth'>,
  group: SpriteExpression | null,
  level: number,
): readonly string[] {
  const alt = group ? config.expressionMouth?.[group] : undefined;
  return alt && level >= alt.fromLevel ? alt.mouth : config.mouth;
}

/** 그림 전체 움직임. y: 면접관 영역 높이 대비 %(+ 아래), rotateDeg: 회전(도) */
export function spriteMotion(
  frame: Pick<AvatarFrame, 'headPitch' | 'headRoll' | 'chestPitch'>,
  config: Pick<SpriteConfig, 'nodShiftPerDeg' | 'breathShiftPerDeg' | 'rollScale' | 'maxRollDeg'>,
): { y: number; rotateDeg: number } {
  const pitchDeg = frame.headPitch / DEG;
  const breathDeg = frame.chestPitch / DEG;
  const y = (pitchDeg * config.nodShiftPerDeg + breathDeg * config.breathShiftPerDeg) * 100;
  // roll + (옆으로 기울임) → 화면에서 왼쪽으로 갸웃
  const rotateDeg = clamp(
    (-frame.headRoll / DEG) * config.rollScale,
    -config.maxRollDeg,
    config.maxRollDeg,
  );
  return { y, rotateDeg };
}

export function maskCss(m: SpriteMask): string {
  return `radial-gradient(ellipse ${m.rx}% ${m.ry}% at ${m.cx}% ${m.cy}%, #000 ${m.solid}%, transparent 100%)`;
}

/** 그림 한 장 로드. 테스트에서 바꿔 끼울 수 있다 */
export type SpriteImageLoader = (img: HTMLImageElement) => Promise<void>;

export const loadImageElement: SpriteImageLoader = (img) =>
  new Promise<void>((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => reject(new Error('load_error')), { once: true });
  }).then(() =>
    // 디코드는 첫 전환 때 끊김을 줄이려는 것뿐이라 기다리지 않아도 된다.
    // 숨겨진 탭에서는 decode() 가 보일 때까지 끝나지 않을 수 있어 짧게만 기다린다(로드 Timeout 방지)
    Promise.race([
      img.decode?.().catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, DECODE_WAIT_MS)),
    ]).then(() => undefined),
  );

export interface SpriteAvatarOptions {
  container: HTMLElement;
  config: SpriteConfig;
  /** 대체 텍스트 (예: '장난꾸러기 악마') */
  alt: string;
  /** 매 프레임 호출. dt 는 초(최대 0.1) */
  onFrame: (dt: number) => AvatarFrame;
  /** 그림 로드 실패·Timeout. cause 예: 'sprite_load_error:mouth_o', 'sprite_load_timeout' */
  onLoadError: (cause: string) => void;
  loadImage?: SpriteImageLoader;
  loadTimeoutMs?: number;
}

/** 지금 보이는 그림 (디버그·테스트용) */
export interface SpriteView {
  expression: string;
  eyes: string | null;
  mouth: string | null;
  y: number;
  rotateDeg: number;
}

type Layer = Map<string, HTMLImageElement>;

const setMask = (el: HTMLElement, m: SpriteMask) => {
  const css = maskCss(m);
  el.style.setProperty('-webkit-mask-image', css);
  el.style.setProperty('mask-image', css);
};

export class SpriteAvatar {
  readonly root: HTMLDivElement;
  /** 그림 전체 움직임(끄덕임·갸웃·호흡)을 받는 요소 */
  readonly character: HTMLDivElement;
  /** 모든 그림이 로드되면 resolve, 실패하면 reject (onLoadError 도 호출) */
  readonly ready: Promise<void>;
  private readonly config: SpriteConfig;
  private readonly expr: Layer = new Map();
  private readonly eyes: Layer = new Map();
  private readonly mouth: Layer = new Map();
  private readonly stepper: ExpressionStepper;
  private view: SpriteView;
  /** 표정 그림 전환 중 아래에 남겨 둔 이전 그림과 숨길 시각 */
  private prevExpr: { name: string; hideAt: number } | null = null;
  /** 지금 목표 표정 단계 (강도 구간 경계 여유 계산용) */
  private target: SpriteTarget = BASE_TARGET;
  private zTop = 1;
  private loaded = false;
  private disposed = false;
  private raf: number | null = null;
  private lastTime: number | null = null;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private fpsFrames = 0;
  private fpsTime = 0;
  private _fps = 0;

  constructor(private readonly opts: SpriteAvatarOptions) {
    const c = (this.config = opts.config);
    this.stepper = new ExpressionStepper(c.stepMs);
    this.view = { expression: c.base, eyes: null, mouth: null, y: 0, rotateDeg: 0 };

    const root = (this.root = document.createElement('div'));
    root.className = 'avatar-sprite';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', `${opts.alt} 면접관`);
    Object.assign(root.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      // 로드 전에는 숨긴다 (일부만 보이는 얼굴 방지)
      visibility: 'hidden',
    } satisfies Partial<CSSStyleDeclaration>);

    // 끄덕임·호흡(위아래)은 영역 기준 %, 갸웃(회전)은 그림의 목 근처 기준
    const mover = document.createElement('div');
    Object.assign(mover.style, { position: 'absolute', inset: '0', willChange: 'transform' });
    const ch = (this.character = document.createElement('div'));
    ch.className = 'avatar-sprite-character';
    Object.assign(ch.style, {
      position: 'absolute',
      left: '50%',
      bottom: `${-c.offsetY * 100}%`,
      height: `${c.scale * 100}%`,
      aspectRatio: '1 / 1',
      transformOrigin: `${c.pivot.x}% ${c.pivot.y}%`,
      transform: 'translateX(-50%)',
    } satisfies Partial<CSSStyleDeclaration>);
    mover.appendChild(ch);
    root.appendChild(mover);

    // 층마다 z-index 를 줘서 쌓임 맥락을 나눈다 (표정 그림끼리의 z-index 가 눈·입 층 위로 올라가지 않게)
    let order = 0;
    const layer = (name: string, mask: SpriteMask | null) => {
      const el = document.createElement('div');
      Object.assign(el.style, { position: 'absolute', inset: '0', zIndex: String(++order) });
      el.dataset.layer = name;
      if (mask) setMask(el, mask);
      ch.appendChild(el);
      return el;
    };
    const exprEl = layer('expression', null);
    const eyeEl = layer('eyes', c.eyeMask);
    const mouthEl = layer('mouth', c.mouthMask);
    const exprNames = [c.base, ...Object.values(c.expressions).flat()];
    for (const n of exprNames) this.addImage(this.expr, exprEl, n, n === c.base);
    for (const n of c.eyes) this.addImage(this.eyes, eyeEl, n, false);
    const exprMouths = Object.values(c.expressionMouth ?? {}).flatMap((m) => m.mouth);
    for (const n of [...c.mouth, ...exprMouths, c.mouthRound]) {
      this.addImage(this.mouth, mouthEl, n, false);
    }

    if (getComputedStyle(opts.container).position === 'static') {
      opts.container.style.position = 'relative';
    }
    opts.container.appendChild(root);
    this.ready = this.preload();
    // 실패는 onLoadError 로 알린다 (처리되지 않은 reject 경고 방지)
    this.ready.catch(() => undefined);
  }

  get fps(): number {
    return this._fps;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  /** 지금 보이는 그림 */
  get current(): SpriteView {
    return { ...this.view };
  }

  private addImage(layer: Layer, parent: HTMLElement, name: string, visible: boolean) {
    if (layer.has(name)) return;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.dataset.sprite = name;
    Object.assign(img.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      opacity: visible ? '1' : '0',
      userSelect: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    img.src = `${this.config.baseUrl}${name}${this.config.ext}`;
    parent.appendChild(img);
    layer.set(name, img);
  }

  private preload(): Promise<void> {
    const load = this.opts.loadImage ?? loadImageElement;
    const all = [...this.expr, ...this.eyes, ...this.mouth].map(([name, img]) =>
      load(img).catch(() => {
        throw new Error(`sprite_load_error:${name}`);
      }),
    );
    const timeout = new Promise<never>((_, reject) => {
      this.loadTimer = setTimeout(
        () => reject(new Error('sprite_load_timeout')),
        this.opts.loadTimeoutMs ?? SPRITE_LOAD_TIMEOUT_MS,
      );
    });
    return Promise.race([Promise.all(all), timeout]).then(
      () => {
        this.clearLoadTimer();
        if (this.disposed) return;
        this.loaded = true;
        this.root.style.visibility = 'visible';
      },
      (err: unknown) => {
        this.clearLoadTimer();
        if (!this.disposed) {
          this.opts.onLoadError(err instanceof Error ? err.message : 'sprite_load_error');
        }
        throw err;
      },
    );
  }

  private clearLoadTimer() {
    if (this.loadTimer !== null) clearTimeout(this.loadTimer);
    this.loadTimer = null;
  }

  start(): void {
    if (this.disposed || this.raf !== null) return;
    const tick = (t: number) => {
      if (this.disposed) return;
      const delta =
        this.lastTime === null ? 0 : Math.min(MAX_DELTA_SEC, (t - this.lastTime) / 1000);
      this.lastTime = t;
      this.applyFrame(this.opts.onFrame(delta), delta * 1000, t);
      this.fpsFrames++;
      this.fpsTime += delta;
      if (this.fpsTime >= 0.5) {
        this._fps = Math.round(this.fpsFrames / this.fpsTime);
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
      this.raf = nextFrame(tick);
    };
    this.raf = nextFrame(tick);
  }

  stop(): void {
    if (this.raf !== null) cancelFrame(this.raf);
    this.raf = null;
    this.lastTime = null;
    this._fps = 0;
  }

  /** 한 프레임 반영. dtMs: 지난 프레임부터의 시간, nowMs: 프레임 시각(이전 표정 그림 숨김 시점 계산) */
  applyFrame(frame: AvatarFrame, dtMs: number, nowMs = performance.now()): void {
    if (this.disposed) return;
    const c = this.config;

    // 표정 (단계 전환)
    this.target = pickSpriteTarget(frame.expressionLevels, c, this.target);
    this.stepper.update(dtMs, this.target);
    const { group, level } = this.stepper;
    const exprName = group && level > 0 ? (c.expressions[group][level - 1] ?? c.base) : c.base;
    if (exprName !== this.view.expression) this.swapExpression(exprName, nowMs);
    if (this.prevExpr && nowMs >= this.prevExpr.hideAt) {
      const prev = this.expr.get(this.prevExpr.name);
      if (prev && this.prevExpr.name !== this.view.expression) prev.style.opacity = '0';
      this.prevExpr = null;
    }

    // 눈 (깜빡임 5단계)
    const eyeIdx = eyeFrameIndex(frame.blink, c.eyes.length);
    const eyes = eyeIdx < 0 ? null : (c.eyes[eyeIdx] ?? null);
    if (eyes !== this.view.eyes) {
      this.toggle(this.eyes, this.view.eyes, eyes);
      this.view.eyes = eyes;
    }

    // 입 (MouthController 출력. 말하지 않으면 0 → 표정 그림의 입)
    const mouth = mouthFrame(frame.jawOpen, frame.visemes, {
      ...c,
      mouth: mouthSetFor(c, group, level),
    });
    if (mouth !== this.view.mouth) {
      this.toggle(this.mouth, this.view.mouth, mouth);
      this.view.mouth = mouth;
    }

    // 그림 전체 움직임 (매 프레임 처음부터 계산, 누적 없음)
    const m = spriteMotion(frame, c);
    const y = Math.round(m.y * 1000) / 1000;
    const r = Math.round(m.rotateDeg * 100) / 100;
    if (y !== this.view.y || r !== this.view.rotateDeg) {
      this.view.y = y;
      this.view.rotateDeg = r;
      (this.character.parentElement as HTMLElement).style.transform = `translateY(${y}%)`;
      this.character.style.transform = `translateX(-50%) rotate(${r}deg)`;
    }
    this.root.dataset.expression = this.view.expression;
    this.root.dataset.eyes = this.view.eyes ?? '';
    this.root.dataset.mouth = this.view.mouth ?? '';
  }

  /** 새 그림을 맨 위에서 나타나게 하고, 이전 그림은 SPRITE_FADE_MS 동안 아래에 남긴다 (투명 틈 방지) */
  private swapExpression(next: string, nowMs: number) {
    const prevName = this.view.expression;
    if (this.prevExpr) {
      // 직전 전환이 아직 진행 중이면(stepMs < 전환 시간) 지금 그림을 바로 다 보이게 하고 그 아래 그림을 숨긴다
      const cur = this.expr.get(prevName);
      if (cur) {
        cur.style.transition = 'none';
        cur.style.opacity = '1';
      }
      const older = this.expr.get(this.prevExpr.name);
      if (older && this.prevExpr.name !== prevName && this.prevExpr.name !== next) {
        older.style.opacity = '0';
      }
    }
    const img = this.expr.get(next);
    if (img) {
      img.style.transition = 'none';
      img.style.opacity = '0';
      img.style.zIndex = String(++this.zTop);
      // 스타일을 한 번 확정한 뒤 opacity 전환을 건다
      void img.offsetWidth;
      img.style.transition = `opacity ${SPRITE_FADE_MS}ms linear`;
      img.style.opacity = '1';
    }
    this.prevExpr = { name: prevName, hideAt: nowMs + SPRITE_FADE_MS + 20 };
    this.view.expression = next;
  }

  private toggle(layer: Layer, from: string | null, to: string | null) {
    if (from) {
      const el = layer.get(from);
      if (el) el.style.opacity = '0';
    }
    if (to) {
      const el = layer.get(to);
      if (el) el.style.opacity = '1';
    }
  }

  /** 두 번 호출해도 안전 */
  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.clearLoadTimer();
    this.root.remove();
    for (const layer of [this.expr, this.eyes, this.mouth]) {
      for (const img of layer.values()) img.removeAttribute('src');
      layer.clear();
    }
  }
}
