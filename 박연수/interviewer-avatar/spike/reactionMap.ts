// 반응 이벤트 → 표정/제스처 매핑표 (verification.md 5장, ARKit 모프 이름)
import type { ExpressionName, GestureName, ReactionEvent } from '@proto/contract';
import { DEFAULT_REACTION_INTENSITY, EXPRESSION_NAMES } from '@proto/contract';
import { DEG } from './controllers/math.ts';

/**
 * 논리 표정 키.
 * smile/frown/smirk: 순간 표정, interest/flat: 태도 바탕 표정, tilt: 갸웃 제스처에 붙는 눈썹
 */
export type ExpressionKey = ExpressionName | 'interest' | 'flat' | 'tilt';

/** 표정 테이블 종류. speaking 만 별도, 나머지 상태(idle/listening/thinking)는 'listening' 테이블 */
export type ExpressionTable = 'listening' | 'speaking';

/** ARKit 모프 이름 → 기본 가중치 */
export type MorphWeights = Record<string, number>;

const both = (prefix: string, weight: number): MorphWeights => ({
  [`${prefix}Left`]: weight,
  [`${prefix}Right`]: weight,
});

/**
 * verification.md 5장 매핑표 그대로.
 * 말할 때는 턱·입(jawOpen, viseme_*)을 립싱크가 소유하므로 입 모프를 줄이거나 뺀다.
 */
export const EXPRESSION_MAP: Record<ExpressionTable, Record<ExpressionKey, MorphWeights>> = {
  listening: {
    smile: { ...both('mouthSmile', 0.6), ...both('cheekSquint', 0.3), ...both('eyeSquint', 0.15) },
    frown: {
      ...both('browDown', 0.6),
      ...both('eyeSquint', 0.15),
      ...both('mouthFrown', 0.35),
      ...both('mouthPress', 0.2),
    },
    interest: { browInnerUp: 0.35, ...both('browOuterUp', 0.25), ...both('eyeWide', 0.25) },
    flat: { ...both('eyeBlink', 0.3), ...both('mouthPress', 0.15) },
    tilt: { browInnerUp: 0.3 },
    // 히죽: 한쪽(왼쪽) 입꼬리·볼·눈가만 + 반대쪽 눈썹 살짝 올림 (장난꾸러기 악마용, 3D 는 참고값)
    smirk: {
      mouthSmileLeft: 0.6,
      cheekSquintLeft: 0.3,
      eyeSquintLeft: 0.15,
      browOuterUpRight: 0.2,
    },
  },
  speaking: {
    smile: {
      ...both('cheekSquint', 0.35),
      ...both('eyeSquint', 0.2),
      ...both('mouthSmile', 0.15),
    },
    frown: { ...both('browDown', 0.6), ...both('eyeSquint', 0.2) },
    interest: { browInnerUp: 0.35, ...both('browOuterUp', 0.25), ...both('eyeWide', 0.25) },
    flat: { ...both('eyeBlink', 0.3) },
    tilt: { browInnerUp: 0.3 },
    smirk: {
      cheekSquintLeft: 0.35,
      eyeSquintLeft: 0.2,
      mouthSmileLeft: 0.15,
      browOuterUpRight: 0.2,
    },
  },
};

/** 표정에 딸린 뼈 동작(고개 pitch, 라디안. + 는 앞으로 숙임). 표정 세기에 비례 */
export const EXPRESSION_HEAD_PITCH: Partial<Record<ExpressionKey, number>> = {
  frown: -2 * DEG, // 고개 뒤로 2°
  interest: 3 * DEG, // 고개 앞으로 3°
};

/** 표정 키별 페르소나 배율 종류 */
export const EXPRESSION_SCALE_KEY: Record<ExpressionKey, 'smileScale' | 'frownScale' | null> = {
  smile: 'smileScale',
  frown: 'frownScale',
  // 히죽도 웃음이라 미소 배율을 쓴다
  smirk: 'smileScale',
  interest: null,
  flat: null,
  tilt: null,
};

/** 깜빡임 모프. 표정 쪽 값은 AvatarFrame.blink 로 합쳐서 내보낸다 */
export const BLINK_MORPHS = ['eyeBlinkLeft', 'eyeBlinkRight'] as const;

/** 눈을 가늘게/감기게 하는 모프. 이 세기만큼 깜빡임을 줄인다(왼쪽 기준, 좌우 대칭) */
export const EYE_CLOSING_MORPHS = ['eyeSquintLeft', 'cheekSquintLeft'] as const;

/** 최종값 = 기본값 × 페르소나 배율 × intensity 의 상한 */
export const MAX_EXPRESSION_WEIGHT = 0.8;

/** 이벤트를 컨트롤러 동작으로 바꾼 결과 */
export type ReactionAction =
  | { kind: 'state'; state: Extract<ReactionEvent, { type: 'state' }>['state'] }
  | {
      kind: 'attitude';
      interest: number;
      trust: number;
      tension: number;
      /** 태도 표정(관심·무덤덤) 세기에 곱한다 (verification.md 5장) */
      intensity: number;
    }
  | {
      kind: 'expression';
      expression: ExpressionName;
      intensity: number;
      durationMs: number | null;
    }
  | { kind: 'gesture'; gesture: GestureName; intensity: number; durationMs: number | null };

/** 매핑 없는 type 이면 null */
export function mapReaction(event: ReactionEvent): ReactionAction | null {
  const intensity = clamp01(event.intensity ?? DEFAULT_REACTION_INTENSITY);
  switch (event.type) {
    case 'state':
      return { kind: 'state', state: event.state };
    case 'attitude':
      return {
        kind: 'attitude',
        interest: clamp01(event.interest),
        trust: clamp01(event.trust),
        tension: clamp01(event.tension),
        intensity,
      };
    case 'expression':
      return (EXPRESSION_NAMES as readonly string[]).includes(event.expression)
        ? {
            kind: 'expression',
            expression: event.expression,
            intensity,
            durationMs: event.durationMs ?? null,
          }
        : null;
    case 'gesture':
      return event.gesture === 'small_nod' || event.gesture === 'nod' || event.gesture === 'tilt'
        ? {
            kind: 'gesture',
            gesture: event.gesture,
            intensity,
            durationMs: event.durationMs ?? null,
          }
        : null;
    default:
      return null;
  }
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
