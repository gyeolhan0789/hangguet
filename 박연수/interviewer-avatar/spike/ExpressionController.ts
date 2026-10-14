// 논리 표정(smile·frown·interest·flat·tilt) → 상태별 ARKit 모프 가중치 (verification.md 3.2·5장)
import type { ExpressionName, InterviewerState } from '@proto/contract';
import type { PersonaConfig } from '../personas.ts';
import {
  BLINK_MORPHS,
  EXPRESSION_HEAD_PITCH,
  EXPRESSION_MAP,
  EXPRESSION_SCALE_KEY,
  EYE_CLOSING_MORPHS,
  MAX_EXPRESSION_WEIGHT,
  type ExpressionKey,
  type ExpressionTable,
} from '../reactionMap.ts';
import type { AttitudeExpression } from './AttitudeController.ts';
import { clamp } from './math.ts';

export const EXPRESSION_RISE_SEC = 0.25;
/** durationMs 가 없을 때 순간 표정 유지 시간 */
export const EXPRESSION_HOLD_SEC = 1.5;
export const EXPRESSION_FALL_SEC = 0.5;
export const STATE_CROSSFADE_SEC = 0.2;

/** ARKit 모프 이름 → 값 */
export type ExpressionWeights = Record<string, number>;

export interface ExpressionOutput {
  /** eyeBlinkLeft/Right 를 제외한 모프 값 */
  weights: ExpressionWeights;
  /** 깜빡임 + 무덤덤(eyeBlink) 표정 합산, 눈 감는 표정만큼 감소 */
  blink: number;
  /** 표정에 딸린 고개 pitch(라디안, + 앞으로) */
  headPitch: number;
  /**
   * 논리 표정 세기(0~1) = 세기 × 페르소나 배율. 2D 그림 렌더러가 그림 단계를 고르는 데 쓴다.
   * 상태 전환 crossfade 는 넣지 않는다(2D 는 그림 단계 전환이 따로 있다)
   */
  levels: ExpressionLevels;
}

/** 논리 표정 키 → 세기(0~1, 페르소나 배율 반영) */
export type ExpressionLevels = Partial<Record<ExpressionKey, number>>;

/** 논리 표정 세기에 페르소나 배율을 곱해 0~1 로 자른다 */
export function scaleLevels(
  amounts: Partial<Record<ExpressionKey, number>>,
  scales: Scales,
): ExpressionLevels {
  const out: ExpressionLevels = {};
  for (const key of Object.keys(amounts) as ExpressionKey[]) {
    const amount = amounts[key] ?? 0;
    if (amount <= 1e-4) continue;
    const scaleKey = EXPRESSION_SCALE_KEY[key];
    out[key] = clamp(amount * (scaleKey ? scales[scaleKey] : 1), 0, 1);
  }
  return out;
}

/** 표정과 함께 들어오는 추가 입력 */
export interface ExpressionExtras {
  /** 갸웃 제스처 진행 정도(0~1, intensity 반영). browInnerUp 으로 나간다 */
  tilt?: number;
}

export function tableForState(state: InterviewerState): ExpressionTable {
  return state === 'speaking' ? 'speaking' : 'listening';
}

/** 순간 표정 세기: 상승(200~300ms) → 유지(holdSec) → 하강 */
export function momentaryEnvelope(t: number, holdSec = EXPRESSION_HOLD_SEC): number {
  if (t < 0) return 0;
  if (t < EXPRESSION_RISE_SEC) return t / EXPRESSION_RISE_SEC;
  const holdEnd = EXPRESSION_RISE_SEC + holdSec;
  if (t < holdEnd) return 1;
  const fall = (t - holdEnd) / EXPRESSION_FALL_SEC;
  return fall < 1 ? 1 - fall : 0;
}

type Scales = Pick<PersonaConfig, 'smileScale' | 'frownScale'>;

/**
 * 논리 표정 세기(intensity 반영값) → ARKit 모프별 최종값.
 * 최종값 = 기본값 × 페르소나 배율 × 세기, 같은 모프는 합산 후 최대 0.8
 */
export function resolveTargets(
  table: ExpressionTable,
  amounts: Partial<Record<ExpressionKey, number>>,
  scales: Scales,
): ExpressionWeights {
  const out: ExpressionWeights = {};
  for (const key of Object.keys(amounts) as ExpressionKey[]) {
    const amount = amounts[key] ?? 0;
    if (amount <= 0) continue;
    const scaleKey = EXPRESSION_SCALE_KEY[key];
    const scale = scaleKey ? scales[scaleKey] : 1;
    for (const [name, weight] of Object.entries(EXPRESSION_MAP[table][key])) {
      out[name] = (out[name] ?? 0) + weight * scale * amount;
    }
  }
  for (const name of Object.keys(out)) {
    out[name] = clamp(out[name] ?? 0, 0, MAX_EXPRESSION_WEIGHT);
  }
  return out;
}

/** 표정 세기 → 고개 pitch 오프셋 */
export function expressionHeadPitch(amounts: Partial<Record<ExpressionKey, number>>): number {
  let pitch = 0;
  for (const key of Object.keys(amounts) as ExpressionKey[]) {
    pitch += (EXPRESSION_HEAD_PITCH[key] ?? 0) * clamp(amounts[key] ?? 0, 0, 1);
  }
  return pitch;
}

interface Momentary {
  kind: ExpressionName;
  t: number;
  intensity: number;
  holdSec: number;
}

export class ExpressionController {
  private state: InterviewerState = 'idle';
  private momentary: Momentary | null = null;
  private fadeFrom: ExpressionWeights = {};
  private fadeT = STATE_CROSSFADE_SEC;
  private last: ExpressionWeights = {};

  constructor(private readonly scales: Scales) {}

  setState(state: InterviewerState): void {
    if (state === this.state) return;
    this.state = state;
    // 이전 표정은 200ms 동안 0으로, 새 표정은 목표값으로
    this.releaseMomentary();
    this.fadeFrom = { ...this.last };
    this.fadeT = 0;
  }

  /**
   * 순간 표정 시작. intensity: 0~1 배율.
   * durationMs: 유지 시간(상승·하강 제외). 생략 시 EXPRESSION_HOLD_SEC
   */
  trigger(kind: ExpressionName, intensity = 1, durationMs: number | null = null): void {
    this.momentary = {
      kind,
      t: 0,
      intensity: clamp(intensity, 0, 1),
      holdSec: durationMs === null ? EXPRESSION_HOLD_SEC : Math.max(0, durationMs) / 1000,
    };
  }

  /** 화면에 나오기 전에 만료된 순간 표정 취소 */
  cancelMomentary(): void {
    this.momentary = null;
  }

  /**
   * 상태 전환 시 진행 중인 순간 표정을 바로 지우지 않고 현재 세기에서 하강 구간으로 넘긴다.
   * (발화 종료로 speaking → listening 이 될 때 미소가 한 프레임에 사라지지 않도록, 2026-10-14)
   */
  private releaseMomentary(): void {
    const mo = this.momentary;
    if (!mo) return;
    const m = momentaryEnvelope(mo.t, mo.holdSec);
    if (m * mo.intensity <= 1e-4) {
      this.momentary = null;
      return;
    }
    this.momentary = { ...mo, intensity: m * mo.intensity, holdSec: 0, t: EXPRESSION_RISE_SEC };
  }

  get activeMomentary(): ExpressionName | null {
    return this.momentary?.kind ?? null;
  }

  update(
    dt: number,
    attitude: AttitudeExpression,
    idleBlink: number,
    extras: ExpressionExtras = {},
  ): ExpressionOutput {
    let m = 0;
    let amount = 0;
    const kind = this.momentary?.kind;
    if (this.momentary) {
      const mo = this.momentary;
      mo.t += dt;
      m = momentaryEnvelope(mo.t, mo.holdSec);
      amount = m * mo.intensity;
      if (mo.t > EXPRESSION_RISE_SEC + mo.holdSec + EXPRESSION_FALL_SEC) this.momentary = null;
    }
    // 순간 표정이 올라오는 만큼 태도 표정은 빠졌다가 끝나면 복귀
    const amounts: Partial<Record<ExpressionKey, number>> = {
      interest: attitude.interest * (1 - m),
      flat: attitude.flat * (1 - m),
    };
    if (kind && amount > 0) amounts[kind] = amount;
    if (extras.tilt && extras.tilt > 0) amounts.tilt = extras.tilt;
    const target = resolveTargets(tableForState(this.state), amounts, this.scales);

    this.fadeT += dt;
    const k = clamp(this.fadeT / STATE_CROSSFADE_SEC, 0, 1);
    const weights: ExpressionWeights = {};
    const names = new Set([...Object.keys(target), ...Object.keys(this.fadeFrom)]);
    for (const name of names) {
      const v = (target[name] ?? 0) * k + (this.fadeFrom[name] ?? 0) * (1 - k);
      if (v > 1e-4) weights[name] = clamp(v, 0, MAX_EXPRESSION_WEIGHT);
    }
    if (k >= 1) this.fadeFrom = {};
    this.last = weights;

    const closing = clamp(
      EYE_CLOSING_MORPHS.reduce((s, n) => s + (weights[n] ?? 0), 0),
      0,
      1,
    );
    const blinkExpr = Math.max(...BLINK_MORPHS.map((n) => weights[n] ?? 0));
    const rest: ExpressionWeights = {};
    for (const [name, v] of Object.entries(weights)) {
      if (!(BLINK_MORPHS as readonly string[]).includes(name)) rest[name] = v;
    }
    return {
      weights: rest,
      blink: clamp(blinkExpr + idleBlink * (1 - closing), 0, 1),
      headPitch: expressionHeadPitch(amounts),
      levels: scaleLevels(amounts, this.scales),
    };
  }
}
