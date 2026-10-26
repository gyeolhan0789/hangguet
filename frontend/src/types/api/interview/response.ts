// 5. 면접 진행 응답. 기준: 웹 Swagger 5.1 ~ 5.15.
import type { LocalDate, OffsetDateTime, Page } from "../common";
import type { Criterion, Grade } from "../growth/response";
import type { InputType, Mode, Persona } from "./request";

/** 면접 상태. READY 시작 전 · IN_PROGRESS 면접 중 · ANALYZING 결과 생성 중 · COMPLETED 결과 있음 · ABORTED 답변 없이 끝남 · FAILED 결과 생성 실패 */
export type SessionStatus =
  "READY" | "IN_PROGRESS" | "ANALYZING" | "COMPLETED" | "ABORTED" | "FAILED";

/** 면접 플랜(질문 · 평가 기준) 상태. GENERATING 만드는 중(S05 [면접 시작] 비활성) · READY 완료 · FAILED 실패(5.3으로 재시도) */
export type PlanStatus = "GENERATING" | "READY" | "FAILED";

/** 결과 생성 단계(S06-1 체크 목록). ORGANIZING_ANSWERS 답변 정리 → SCORING 기준별 분석 → WRITING_FEEDBACK 피드백 작성 */
export type AnalysisStep = "ORGANIZING_ANSWERS" | "SCORING" | "WRITING_FEEDBACK";

/** 웹 Swagger 5.14 면접방 입장 정보. 로그인 토큰과 별개로 이 방에만 사용할 수 있다. */
export interface RoomResponse {
  url: string;
  token: string;
  expiresAt: OffsetDateTime;
}

/** 지금 답할 질문 */
export interface CurrentQuestion {
  /** 질문 id */
  id: number;
  /** 질문 순서(1부터). "질문 3 / 5"의 3 */
  seq: number;
  /** 질문 내용 */
  content: string;
}

/** 5.1(201) · 5.2(200) · 5.3(202) · 5.4(200) · 5.8(202 · 200) · 5.9(202) */
export interface SessionResponse {
  /** 면접 id */
  id: number;
  /** 지원서 id */
  applicationId: number;
  /** 지원 회사명 */
  companyName: string;
  /** 지원 직무 */
  jobTitle: string;
  persona: Persona;
  mode: Mode;
  status: SessionStatus;
  planStatus: PlanStatus;
  /** 면접 플랜 준비 진행률(0~100). S05-E "질문 준비 78%". planStatus가 GENERATING일 때만 값, 나머지는 null */
  planProgress: number | null;
  /** status가 ANALYZING일 때만 값, 나머지는 null */
  analysisStep: AnalysisStep | null;
  /** 지금 답할 질문. 면접 중이 아니거나 다음 질문을 만드는 중이면 null */
  currentQuestion: CurrentQuestion | null;
  /** 지금까지 낸 답변 수. S06-E "답변한 2개 질문까지" */
  answeredCount: number;
  /** 면접 경과 시간(초). S06 "08:42". 연결이 끊겨 멈춘 시간은 빠진다. 시작 전이면 0 */
  elapsedSeconds: number;
  /** 면접 시작 일시. 시작 전이면 null */
  startedAt: OffsetDateTime | null;
  /** 면접 종료 일시. 끝나기 전이면 null */
  endedAt: OffsetDateTime | null;
  /** 면접을 만든 일시 */
  createdAt: OffsetDateTime;
  /** 이번에 끝낸 면접으로 스트릭이 올라 뱃지 구간이 바뀌었으면 true. 5.8 응답에만 값이 있고, 그 외에는 null */
  leveledUp: boolean | null;
  /** 면접방 입장 정보. 5.4 응답에만 값이 있고, 그 외에는 null */
  room: RoomResponse | null;
}

/** 5.5 지금 질문 (200) */
export interface QuestionResponse {
  /** 질문 id */
  id: number;
  /** 질문 순서(1부터) */
  seq: number;
  /** 질문 내용 */
  content: string;
  /** 질문을 낸 일시 */
  createdAt: OffsetDateTime;
}

/** 5.5 지금 질문 (202, 오류 아님). 다음 질문을 준비 중이면 2초 뒤(임시 값) 다시 부른다 */
export interface PendingResponse {
  /** 대기 이유. 지금은 "QUESTION_GENERATING"(다음 질문 준비 중) 하나다. 웹 Swagger는 enum 없이 문자열로 준다 */
  code: string;
}

/** 5.7 답변 제출 (202) */
export interface AnswerResponse {
  /** 답변 id */
  id: number;
  /** 질문 id */
  questionId: number;
  inputType: InputType;
  /** 제출 일시 */
  createdAt: OffsetDateTime;
  /** 마지막 질문이었으면 true → 화면이 면접 끝내기(5.8) 호출. false면 다음 질문을 기다린다 */
  isLastQuestion: boolean;
}

/** 5.13 기준별 등급(6.3 sessionScores에서 기준 · 등급만) */
export interface CriterionGrade {
  criterion: Criterion;
  grade: Grade;
}

/** 5.13 연습 면접 목록의 면접 하나 */
export interface SessionListItem {
  /** 면접 id. [상세 피드백] · [다시보기]의 sessionId */
  id: number;
  companyName: string;
  jobTitle: string;
  persona: Persona;
  mode: Mode;
  /** 본인의 답변 1개 이상인 ANALYZING · COMPLETED · FAILED만 온다(웹 Swagger 5.13) */
  status: Extract<SessionStatus, "ANALYZING" | "COMPLETED" | "FAILED">;
  startedAt: OffsetDateTime;
  endedAt: OffsetDateTime;
  answeredCount: number;
  /** 6.3의 한 줄 총평. 없으면 null(웹 Swagger 5.13 예시 · 웹 목 서버 2026-10-20 실제 응답의 COMPLETED id 52) */
  summary: string | null;
  /** COMPLETED만 4개. ANALYZING · FAILED는 빈 배열 */
  criterionGrades: CriterionGrade[];
}

/** 5.13 페이지와 무관한 집계 */
export interface SessionListSummary {
  /** 날짜와 무관한 본인의 전체 연습 면접 수(상단 보관함 건수) */
  totalInterviewCount: number;
  /** 선택 날짜 전체 연습 시간(분) */
  practiceMinutes: number;
}

/** 5.13 연습 면접 목록 (200). 기록 없는 날짜 · 범위를 넘는 페이지도 200(빈 content) */
export interface SessionListResponse extends Page<SessionListItem> {
  summary: SessionListSummary;
}

/** 5.15 날짜 하나의 연습 면접 수 */
export interface SessionCalendarDay {
  /** 한국 시간 면접 시작 날짜 */
  practiceDate: LocalDate;
  /** 해당 날짜의 연습 면접 수. 기록이 없으면 0 */
  interviewCount: number;
}

/** 5.15 월별 연습 면접 횟수 (200). 조회 월의 모든 날짜를 오름차순으로, 기록이 없는 날짜도 포함한다 */
export interface SessionCalendarResponse {
  /** 조회한 월(YYYY-MM) */
  month: string;
  content: SessionCalendarDay[];
}
