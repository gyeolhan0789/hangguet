// 면접관 표현 모듈 공통 계약 (FE · BE · AI · avatar 공용)

export const INTERVIEWER_STATES = ['idle', 'listening', 'thinking', 'speaking'] as const;
export type InterviewerState = (typeof INTERVIEWER_STATES)[number];

/**
 * devil_interviewer · dev_coffee_chat: 3D(GLB) 면접관.
 * devil_character: 2D 그림 면접관(장난꾸러기 악마, 표정 그림 바꿔 끼우기). overview.md 3장
 */
export const PERSONA_IDS = ['devil_interviewer', 'dev_coffee_chat', 'devil_character'] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

export const QUESTION_MODES = ['voice', 'text', 'both'] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];
/** 질문 모드 기본값. decisions.md ①-4: 화상·채팅 모두 질문을 음성으로 읽고 글(말풍선)도 표시 */
export const DEFAULT_QUESTION_MODE: QuestionMode = 'both';

/** 한 면접의 질문 수 (화면 상단 '질문 n/5'). 프로토타입은 페르소나별 고정 질문 */
export const QUESTIONS_PER_INTERVIEW = 5;

export type ReactionSource = 'local' | 'server';
/**
 * 순간 표정. smirk: 한쪽 입꼬리만 올린 히죽 웃음(장난꾸러기 악마가 자주 씀).
 * 3D 는 한쪽 mouthSmile 등으로, 2D 는 히죽 그림으로 표현한다
 */
export const EXPRESSION_NAMES = ['smile', 'frown', 'smirk'] as const;
export type ExpressionName = (typeof EXPRESSION_NAMES)[number];
export type GestureName = 'small_nod' | 'nod' | 'tilt';

export interface ReactionEventBase {
  eventId: string;
  sessionId: string;
  turnId: string;
  /** 출처(source)별 단조 증가. 마지막 처리값 이하이면 무시 */
  sequence: number;
  /** 상대 만료 시간. 받은 시각 + ttlMs 가 지나면 무시 */
  ttlMs: number;
  source: ReactionSource;
  /**
   * 표현 강도 0~1. 생략 시 1(DEFAULT_REACTION_INTENSITY).
   * 최종값 = 기본값 × 페르소나 배율 × intensity (최대 0.8).
   * 순간 표정·제스처뿐 아니라 attitude(관심·무덤덤 태도 표정 세기)에도 적용한다
   */
  intensity?: number;
  /** 발화 연계 반응: 묶인 발화(speak 의 utteranceId). 해당 발화가 stop 되면 함께 취소 */
  utteranceId?: string;
  /**
   * 발화 연계 반응: 해당 발화 시작 기준 지연(ms, 0 이상). utteranceId 와 함께 쓴다.
   * 만료 규칙은 다른 반응과 같다(받은 시각 + ttlMs). 실행 시점(발화 시작 + offsetMs)에 다시 확인해
   * 지났으면 버리므로, ttlMs 는 발화 시작까지 남은 시간 + offsetMs 보다 넉넉히 준다
   */
  offsetMs?: number;
}

/** 순간 표정·제스처 공통 선택 필드 */
export interface ReactionDuration {
  /**
   * 표정: 유지 시간(ms, 상승·하강 제외). 갸웃: 전체 길이(ms, 0.4~1.2초로 제한).
   * 끄덕임은 고정 길이라 쓰지 않는다. 생략 시 표현 모듈 기본값(표정 1.5초 유지, 갸웃 1.2초)
   */
  durationMs?: number;
}

/** intensity 생략 시 기본값 */
export const DEFAULT_REACTION_INTENSITY = 1;

export type StateReaction = ReactionEventBase & { type: 'state'; state: InterviewerState };
/** 0~1 연속값 */
export type AttitudeReaction = ReactionEventBase & {
  type: 'attitude';
  interest: number;
  trust: number;
  tension: number;
};
export type ExpressionReaction = ReactionEventBase &
  ReactionDuration & {
    type: 'expression';
    expression: ExpressionName;
  };
export type GestureReaction = ReactionEventBase &
  ReactionDuration & { type: 'gesture'; gesture: GestureName };

export type ReactionEvent = StateReaction | AttitudeReaction | ExpressionReaction | GestureReaction;
export type ReactionType = ReactionEvent['type'];
export const REACTION_TYPES = [
  'state',
  'attitude',
  'expression',
  'gesture',
] as const satisfies readonly ReactionType[];

export function isKnownReactionType(type: unknown): type is ReactionType {
  return typeof type === 'string' && (REACTION_TYPES as readonly string[]).includes(type);
}

// ---- REST DTO ----
export interface CreateSessionReq {
  persona: PersonaId;
  mode: QuestionMode;
}
export interface CreateSessionRes {
  sessionId: string;
}
export interface NextQuestionRes {
  turnId: string;
  questionId: string;
  /** 이 질문 발화의 식별자(turnId 기반, BE 발급). avatar.speak/stop 과 발화 연계 반응이 가리킨다. done 이면 빈 문자열 */
  utteranceId: string;
  text: string;
  /** 읽기용 Presigned URL. TTS 실패 시 null */
  audioUrl: string | null;
  ttsFailed: boolean;
  /** 질문 소진 시 true (이때 text 등은 비어 있을 수 있음) */
  done: boolean;
}
export type SessionPhase = 'speaking' | 'listening' | 'thinking' | 'done';
export interface SessionStateRes {
  sessionId: string;
  persona: PersonaId;
  mode: QuestionMode;
  turnId: string;
  phase: SessionPhase;
}

// ---- AI 서버 (BE → AI) ----
export interface GenerateQuestionReq {
  persona: PersonaId;
  index: number;
  /** AI가 WAV를 PUT 할 업로드용 Presigned URL */
  uploadUrl: string;
}
export interface GenerateQuestionRes {
  text: string;
  ttsOk: boolean;
  done: boolean;
}

// ---- WebSocket ----
export interface WsReactionMessage {
  kind: 'reaction';
  event: ReactionEvent;
}
export type ServerToClientMessage = WsReactionMessage;

export type ClientToServerMessage =
  { kind: 'listening_started'; turnId: string } | { kind: 'answer_completed'; turnId: string };
