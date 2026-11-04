// 6. 녹화 · 결과 · 다시보기 응답. 기준: 웹 Swagger 6.3 · 6.4.
// 소수도 JSON 숫자로 온다.
import type { OffsetDateTime } from "../common";
import type { Criterion, Grade } from "../growth/response";
import type { Mode, Persona } from "../interview/request";
import type { RecordingType } from "./request";

/** 6.2 녹화 등록 (201) */
export interface RecordingResponse {
  /** 파일 id */
  id: number;
  recordingType: RecordingType;
  /** 업로드를 마친 일시 */
  createdAt: OffsetDateTime;
}

/** 평가 기준 하나의 결과 */
export interface SessionScore {
  criterion: Criterion;
  /** 점수(0~100). */
  score: number;
  /** 3단계 */
  grade: Grade;
  /** 한 줄 설명. 성장 리뷰의 "다음에 해볼 것"에도 쓰인다 */
  comment: string;
}

/** 질문별 피드백 */
export interface AnswerFeedback {
  /** 질문 id */
  questionId: number;
  /** 질문 순서 */
  seq: number;
  /** 질문 내용 */
  question: string;
  /** 내 답변(화상은 음성 인식한 글) */
  content: string;
  /** 점수(0~100) */
  score: number;
  /** 3단계 */
  grade: Grade;
  /** 잘한 점. 없으면 null(웹 Swagger 6.3 예시 4번 질문) */
  goodPoint: string | null;
  /** 아쉬운 점 */
  improvePoint: string;
}

/** 음성 지표(화상 면접). 웹 Swagger 6.3에는 필드 설명 없이 예시 값만 있다 */
export interface SpeechMetrics {
  fillerPerMin: number;
  longPauseCount: number;
  speedDeviationPct: number;
  trailingOffRatio: number;
  pitchRangeSt: number;
  /** 면접 동안 면접관을 바라본 시간 비율(%). 화면이 브라우저에서 재어 5.8로 보낸 값이고, 받지 못했으면 null */
  gazeRatio: number | null;
}

/** 6.3 면접 결과 (200) */
export interface ResultResponse {
  /** 면접 id */
  id: number;
  persona: Persona;
  mode: Mode;
  /** 지원 회사명 */
  companyName: string;
  /** 지원 직무 */
  jobTitle: string;
  /** 맨 위 한 줄 총평. 없으면 null(웹 Swagger 5.13 "평가·총평은 6.3 결과의 요약"이고, 웹 목 서버 5.13 실제 응답에 총평 없는 COMPLETED(id 52)가 있다) */
  summary: string | null;
  /** 면접 시작 일시. 화면의 "18분"은 endedAt과의 차이 */
  startedAt: OffsetDateTime;
  /** 면접 종료 일시 */
  endedAt: OffsetDateTime;
  /** 평가 기준 4개 */
  sessionScores: SessionScore[];
  /** 질문별 피드백, 질문 순 */
  answers: AnswerFeedback[];
  /** 음성 지표. 채팅 면접이면 null */
  speechMetrics: SpeechMetrics | null;
}

/** 다시보기 질문 하나 */
export interface ReplayItem {
  /** 질문 id */
  questionId: number;
  /** 질문 순서 */
  seq: number;
  /** 질문 내용 */
  question: string;
  /** 질문을 낸 일시. startedAt과의 차이(초)가 영상 속 질문 위치(마커) */
  questionCreatedAt: OffsetDateTime;
  /** 답변 글. 재생 중 자막(답변 단위). 답하지 않은 질문이면 null */
  answer: string | null;
  /** 답변 제출 일시. 답하지 않은 질문이면 null */
  answerCreatedAt: OffsetDateTime | null;
  /** 질문별 3단계. 답하지 않은 질문이면 null */
  grade: Grade | null;
  /** 다시보기 타임라인(화상만). 채팅 · 답하지 않은 질문 · 만들지 못한 답변은 null */
  timeline: ReplayTimeline | null;
}

/** 체크포인트 이유. 인상 6항목(STABILITY ~ TRUST)과 음성 3개(TRAILING_OFF · FILLER · LONG_PAUSE) */
export type TimelineMetric =
  | "STABILITY"
  | "CONFIDENCE"
  | "EXPRESSION"
  | "EMOTION"
  | "LIKEABILITY"
  | "TRUST"
  | "TRAILING_OFF"
  | "FILLER"
  | "LONG_PAUSE";

/** 곡선의 1초. 시각은 영상 위치(초) */
export interface TimelinePoint {
  at: number;
  /** 그 면접 평균이 0인 표준화 값. 음수면 평소보다 아쉬움 */
  value: number;
}

export interface TimelineReason {
  metric: TimelineMetric;
  /** 음성 이유의 앞뒤 5초 횟수. 인상 이유면 null */
  count: number | null;
  /** 보완할 점 */
  text: string;
}

/** 평소보다 유난히 낮은 지점 */
export interface TimelineCheckpoint {
  /** 가장 낮은 지점(영상 위치, 초) */
  at: number;
  start: number;
  end: number;
  value: number;
  reasons: TimelineReason[];
}

/** 6.4 다시보기 타임라인(화상만). 그 답변 동안의 면접 흐름 */
export interface ReplayTimeline {
  /** 1초 간격 */
  points: TimelinePoint[];
  /** 시간 순 */
  checkpoints: TimelineCheckpoint[];
}

/** 6.4 녹화 영상 상태 */
export type VideoStatus = "READY" | "MERGING" | "FAILED";

/** 6.4 다시보기 (200) */
export interface ReplayResponse {
  /** 면접 id */
  id: number;
  persona: Persona;
  /** VIDEO면 영상, CHAT이면 대화 기록 */
  mode: Mode;
  /** 지원 회사명 */
  companyName: string;
  /** 지원 직무 */
  jobTitle: string;
  /** 면접 시작 일시. 상단 날짜 */
  startedAt: OffsetDateTime;
  /** 녹화 영상의 0초에 해당하는 시각. 채팅이거나 이전 면접 · 녹화 시작 시각을 얻지 못했으면 null(이때는 startedAt이 기준) */
  recordingStartedAt: OffsetDateTime | null;
  /** 녹화 영상 상태. READY 재생 가능, MERGING 녹화 합치기 중(10초마다 다시 조회), FAILED 합치기 실패. 채팅이면 null */
  videoStatus: VideoStatus | null;
  /** 녹화 영상 주소. videoStatus가 READY일 때만 값이 있다(웹 Swagger 6.4) */
  videoUrl: string | null;
  /** 질문 순 */
  items: ReplayItem[];
}

// 6.1 녹화 업로드 주소(200)는 공통 UploadUrlResponse(../common)
