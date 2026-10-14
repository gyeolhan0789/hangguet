import type { PersonaId } from '@proto/contract';

export interface Attitude {
  interest: number;
  trust: number;
  tension: number;
}

export interface PersonaCameraConfig {
  /** 정면 기준 수평 회전(도). + 는 면접관 기준 왼쪽에서 바라봄 */
  yawDeg: number;
  /** head bone 높이 대비 카메라 높이(m). 눈은 head bone 보다 약 0.1m 위 */
  heightOffset: number;
  /** 화면에 담을 세로 범위(m). 화면 위쪽 끝(head bone + topMargin)부터 아래로 */
  frameHeight: number;
  /** head bone(목과 머리 경계) 위로 화면 위쪽 끝까지의 여백(m). 머리 꼭대기는 약 0.2m 위 */
  topMargin: number;
  fovDeg: number;
}

/**
 * 그림 위의 부위 마스크 (타원 radial-gradient). 단위는 그림 크기 대비 %.
 * solid: 타원 반지름 중 완전히 보이는 안쪽 비율(%), 그 밖은 바깥 끝까지 서서히 투명
 */
export interface SpriteMask {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  solid: number;
}

/** 2D 그림 표정 그룹. brows 는 관심(태도)과 갸웃 눈썹에 함께 쓴다 */
export type SpriteExpression = 'smile' | 'frown' | 'brows' | 'smirk';

/**
 * 2D 그림 면접관 설정 (renderer 'sprite2d'). 그림은 모두 같은 구도·크기(투명 배경 정사각형)로 정렬돼 있어야 한다.
 * 새 표정 그림 추가 방법은 verification.md 3.4 참고
 */
export interface SpriteConfig {
  /** 그림 폴더 URL (끝에 /) */
  baseUrl: string;
  /** 파일 확장자 (예: '.webp') */
  ext: string;
  /** 기본 얼굴 (정지 이미지 fallback 에도 쓴다) */
  base: string;
  /** 표정별 단계 그림 (기본 다음 단계부터 완전한 표정까지 순서대로). 기본 그림은 넣지 않는다 */
  expressions: Record<SpriteExpression, readonly string[]>;
  /** 눈 감김 단계 (1/4 → 반 → 3/4 → 감음). 뜬 눈은 표정 그림의 눈을 그대로 쓴다 */
  eyes: readonly string[];
  /** 입 벌림 단계 (아주 살짝 → 조금 → 중간 → 크게). 다문 입은 표정 그림의 입을 그대로 쓴다 */
  mouth: readonly string[];
  /**
   * 표정별 말하는 입 (선택). 지금 보이는 표정 그림이 그 표정의 fromLevel 단계 이상이면 mouth 대신 이 목록을 쓴다.
   * 예: 웃으며 말하는 입. 없으면 표정과 상관없이 mouth(무표정으로 말하는 입)
   */
  expressionMouth?: Partial<
    Record<SpriteExpression, { fromLevel: number; mouth: readonly string[] }>
  >;
  /** '오/우' 처럼 동그랗게 오므린 입 (HeadAudio viseme_O · viseme_U 일 때) */
  mouthRound: string;
  /** MouthController 출력(0~1) → 입 단계 경계. 이 값 미만이면 앞 단계. 예: [다묾|아주 살짝|조금|중간|크게] */
  mouthThresholds: readonly [number, number, number, number];
  /**
   * 눈 부위 마스크 (깜빡임 그림을 표정 그림 위에 겹칠 때). null 이면 마스크 없이 그림의 투명도 그대로 겹친다
   * (그림 자체가 부위 조각으로 만들어진 경우, bake.mjs)
   */
  eyeMask: SpriteMask | null;
  /** 입 부위 마스크 (말할 때 입 그림을 표정 그림 위에 겹칠 때). null 이면 그림의 투명도 그대로 */
  mouthMask: SpriteMask | null;
  /** 표정 단계 사이 그림 한 장당 시간(ms) */
  stepMs: number;
  /** 이보다 약한 표정 세기는 기본 얼굴로 본다 */
  minExpressionLevel: number;
  /** 그림 높이 / 면접관 영역 높이 (배율). 그림 아래 끝을 영역 아래에 맞춘다 */
  scale: number;
  /** 아래로 내리는 양(면접관 영역 높이 대비 비율). 끄덕임·갸웃 때 아래 끝이 보이지 않게 조금 내린다 */
  offsetY: number;
  /** 회전·끄덕임 기준점 (그림 대비 %, 목 근처) */
  pivot: { x: number; y: number };
  /** 고개 pitch 1° 당 아래로 이동(영역 높이 대비 비율). 끄덕임 */
  nodShiftPerDeg: number;
  /** 호흡(chestPitch) 1° 당 위아래 이동(영역 높이 대비 비율) */
  breathShiftPerDeg: number;
  /** 고개 roll → 그림 회전 배율 (3D 갸웃 10° → 5°) */
  rollScale: number;
  /** 그림 회전 최대(도) */
  maxRollDeg: number;
}

/** glb: 3D 모델(GLB) 렌더러 / sprite2d: 2D 표정 그림 바꿔 끼우기 */
export type PersonaRenderer = 'glb' | 'sprite2d';

export interface PersonaConfig {
  id: PersonaId;
  label: string;
  /** 기본 렌더러. createAvatar({ renderer }) 로 바꿀 수 있다 */
  renderer: PersonaRenderer;
  /** renderer 가 sprite2d 일 때의 그림 설정 */
  sprite?: SpriteConfig;
  /** 정지 이미지 fallback 위치. 생략 시 fallback/<persona>.png */
  staticImageUrl?: string;
  /** 모델 위치는 이 파일에서만 정의 (추후 Storage 이전 대비) */
  modelUrl: string;
  /**
   * 모델에서 숨길 메시 이름(정확히 일치). 기본 빈 목록.
   * 예: 하체 메시가 남아 있는 모델이면 여기에 이름을 넣는다
   */
  hiddenMeshes: string[];
  /**
   * MouthController 출력(0~1) → jawOpen 모프 상한. 출력 1 이 이 값이 된다(선형).
   * decisions.md: 0.5~0.6 (그보다 크면 혀·치아가 과하게 보임)
   */
  jawOpenMax: number;
  baseAttitude: Attitude;
  attitudeBlendSec: number;
  smileScale: number;
  frownScale: number;
  nodScale: number;
  gestureCooldownMs: number;
  blinkIntervalSec: [number, number];
  camera: PersonaCameraConfig;
  background: string;
  readCharsPerSec: number;
  voiceRate: number;
  /** placeholder 아바타 옷 색 */
  suitColor: string;
}

const MODEL_BASE = `${import.meta.env.BASE_URL}models/`;
const CHARACTER_BASE = `${import.meta.env.BASE_URL}characters/`;

/**
 * 장난꾸러기 악마 2D 그림 (768×768 투명 배경 WebP 25장, 저장소에는 넣지 않음. 그림은 verification.md 2.3).
 * 외형은 사람 모습의 악마(작은 뿔·붉은 눈, 반실사 일러스트). 눈·입 그림은 bake.mjs 로 "부위 조각"(겹칠 곳만 불투명)으로
 * 만들어 두었으므로 CSS 마스크를 쓰지 않는다. 타원 마스크는 실사풍 그림에서 표정 그림의 입꼬리 · 눈썹이 겹쳐 보였다
 */
const SMILE_TALK = ['smile_talk_tiny', 'smile_talk_small', 'smile_talk_mid', 'smile_talk_wide'];

export const DEVIL_CHARACTER_SPRITE: SpriteConfig = {
  baseUrl: `${CHARACTER_BASE}devil_character/web/`,
  ext: '.webp',
  base: '00_base',
  expressions: {
    smile: ['smile_33', 'smile_66', '05_smile'],
    frown: ['frown_33', 'frown_66', '06_frown'],
    brows: ['brows_33', 'brows_66', '07_brows_up'],
    smirk: ['smirk_50', 'smirk'],
  },
  eyes: ['eyes_25', '01_eyes_half', 'eyes_75', '02_eyes_closed'],
  mouth: ['mouth_tiny', '03_mouth_small', 'mouth_mid', '04_mouth_wide'],
  // 웃는 얼굴(미소 2/3 단계 이상 · 완전한 히죽)로 말할 때는 웃으며 말하는 입. 무표정 입을 얹으면 미소가 사라진다
  expressionMouth: {
    smile: { fromLevel: 2, mouth: SMILE_TALK },
    smirk: { fromLevel: 2, mouth: SMILE_TALK },
  },
  mouthRound: 'mouth_o',
  // 크게(04_mouth_wide)는 아주 큰 소리(0.88 이상)일 때만
  mouthThresholds: [0.15, 0.35, 0.6, 0.88],
  eyeMask: null,
  mouthMask: null,
  stepMs: 70,
  minExpressionLevel: 0.1,
  scale: 1.0,
  offsetY: 0.02,
  pivot: { x: 50, y: 85 },
  // 끄덕임(악마 nodScale 0.6 × 10° = 6°)이 540px 영역에서 약 6px
  nodShiftPerDeg: 1 / 540,
  // 호흡 ±0.8° → 약 ±1.2px
  breathShiftPerDeg: 1.5 / 540,
  rollScale: 0.5,
  maxRollDeg: 5,
};

/**
 * 이전 기본 모델(TalkingHead 예제 mpfb.glb 기반 여성 모델). 페르소나에는 쓰지 않고
 * 새 모델과 비교하거나 임시로 대체할 때만 쓴다 (sandbox 의 모델 URL 입력란)
 */
export const LEGACY_MODEL_URL = `${MODEL_BASE}interviewer.meshopt.glb`;

/** jawOpen 상한 기본값 (decisions.md: 0.5~0.6) */
export const DEFAULT_JAW_OPEN_MAX = 0.55;

// 두 모델 모두 MPFB + TalkingHead 리그(뼈 63개, 루트 Armature), 하체 삼각형은 빌드 때 지웠다(y<0.88m).
// 실측(rest): devil head bone 1.57m · 눈 1.67m, coffee head bone 1.56m · 눈 1.66m.
// 구도는 head bone 기준이라 키가 조금 달라도 얼굴 위치는 같다.
// 화면 구도(decisions.md): 얼굴이 화면 위쪽 1/3 안, 하단 말풍선이 가슴 아래를 덮는다
export const PERSONAS: Record<PersonaId, PersonaConfig> = {
  devil_interviewer: {
    id: 'devil_interviewer',
    label: '악마 면접관',
    renderer: 'glb',
    // 40대 남성, 검은 정장·흰 셔츠·남색 넥타이 ('악마'는 질문 스타일, 외형 아님)
    modelUrl: `${MODEL_BASE}devil_interviewer.meshopt.glb`,
    hiddenMeshes: [],
    jawOpenMax: DEFAULT_JAW_OPEN_MAX,
    baseAttitude: { interest: 0.3, trust: 0.5, tension: 0.6 },
    attitudeBlendSec: 3,
    smileScale: 0.75,
    frownScale: 1.3,
    nodScale: 0.6,
    gestureCooldownMs: 6000,
    blinkIntervalSec: [3, 6],
    // 정면, 눈보다 조금 아래에서
    camera: { yawDeg: 0, heightOffset: 0.0, frameHeight: 0.84, topMargin: 0.26, fovDeg: 26 },
    background: '#2b2d31',
    readCharsPerSec: 7,
    voiceRate: 1.05,
    suitColor: '#26282d',
  },
  dev_coffee_chat: {
    id: 'dev_coffee_chat',
    label: '개발자 커피챗',
    renderer: 'glb',
    // 30대 남성, 체크 셔츠
    modelUrl: `${MODEL_BASE}dev_coffee_chat.meshopt.glb`,
    hiddenMeshes: [],
    jawOpenMax: DEFAULT_JAW_OPEN_MAX,
    baseAttitude: { interest: 0.7, trust: 0.5, tension: 0.2 },
    attitudeBlendSec: 2,
    smileScale: 0.9,
    frownScale: 0.7,
    nodScale: 1.2,
    gestureCooldownMs: 2500,
    blinkIntervalSec: [2, 4],
    // 눈높이, 약간 비스듬히
    camera: { yawDeg: 12, heightOffset: 0.1, frameHeight: 0.84, topMargin: 0.26, fovDeg: 28 },
    background: '#efe4d2',
    readCharsPerSec: 7,
    voiceRate: 1.0,
    suitColor: '#4a6a8f',
  },
  devil_character: {
    id: 'devil_character',
    label: '장난꾸러기 악마',
    // MVP 는 2D 그림 면접관 (decisions.md). 같은 캐릭터의 3D 모델은 비교용으로 남긴다(createAvatar({ renderer: 'glb' }))
    renderer: 'sprite2d',
    sprite: DEVIL_CHARACTER_SPRITE,
    staticImageUrl: `${DEVIL_CHARACTER_SPRITE.baseUrl}${DEVIL_CHARACTER_SPRITE.base}${DEVIL_CHARACTER_SPRITE.ext}`,
    // 붉은 피부·뿔·뾰족한 귀·동그란 안경, 남색 정장·흰 셔츠·빨간 넥타이
    modelUrl: `${MODEL_BASE}devil_character.meshopt.glb`,
    hiddenMeshes: [],
    jawOpenMax: DEFAULT_JAW_OPEN_MAX,
    baseAttitude: { interest: 0.6, trust: 0.5, tension: 0.4 },
    attitudeBlendSec: 2,
    // 히죽(smirk)도 미소 배율을 쓴다
    smileScale: 0.8,
    frownScale: 1.0,
    nodScale: 0.6,
    gestureCooldownMs: 5000,
    blinkIntervalSec: [2, 5],
    // 정면, 눈높이 (3D 비교용)
    camera: { yawDeg: 0, heightOffset: 0.1, frameHeight: 0.84, topMargin: 0.26, fovDeg: 26 },
    background: '#3a2a3f',
    readCharsPerSec: 7,
    voiceRate: 1.0,
    suitColor: '#26335c',
  },
};

export function getPersona(id: PersonaId): PersonaConfig {
  return PERSONAS[id];
}
