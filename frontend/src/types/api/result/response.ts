// 6. 녹화 · 결과 · 다시보기 응답. 기준: mock ResultDtos · ResultController.
// 자바 BigDecimal도 JSON 숫자로 온다.
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
  /** 점수(0~100). 자소서 검증은 답변이 자소서와 명확하게 충돌한 개수만큼 100점에서 차감(B-10) */
  score: number;
  /** 3단계 */
  grade: Grade;
  /** 한 줄 설명. 성장 리뷰의 "다음에 해볼 것"에도 쓰인다 */
  comment: string | null;
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
  /** 잘한 점 */
  goodPoint: string | null;
  /** 아쉬운 점. 성장 리뷰의 "다음에 해볼 것"에도 쓰인다 */
  improvePoint: string | null;
}

/** 음성 지표. 값을 구하지 못한 항목은 null */
export interface SpeechMetrics {
  /** 1분당 군말('음', '어') 횟수 */
  fillerPerMin: number | null;
  /** 문장 중간에 길게 멈춘 횟수 */
  longPauseCount: number | null;
  /** 평소 말 속도와의 차이(%) */
  speedDeviationPct: number | null;
  /** 말끝을 흐린 문장 비율(%) */
  trailingOffRatio: number | null;
  /** 억양 변화 폭(세미톤) */
  pitchRangeSt: number | null;
  /** 말하는 동안 면접관을 바라본 시간 비율(%). 녹화 영상으로 구하므로 녹화가 없으면 null */
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
  /** 맨 위 한 줄 총평 */
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
  /** 질문을 낸 일시. startedAt과의 차이(초)가 영상 속 질문 위치(마커). 1~2초 오차 */
  questionCreatedAt: OffsetDateTime;
  /** 답변 글. 재생 중 자막(답변 단위) */
  answer: string | null;
  /** 답변 제출 일시 */
  answerCreatedAt: OffsetDateTime | null;
  /** 질문별 3단계 */
  grade: Grade | null;
}

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
  /** 녹화 기준 시각(면접 시작 일시). 상단 날짜도 이 값 */
  startedAt: OffsetDateTime;
  /** 녹화 영상 임시 주소(만료됨). 채팅이거나 녹화가 없거나 보관 기간이 지났으면 null */
  videoUrl: string | null;
  /** 질문 순 */
  items: ReplayItem[];
}

// 6.1 녹화 업로드 주소(200)는 공통 UploadUrlResponse(../common)
