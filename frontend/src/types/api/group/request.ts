// 10. 그룹 면접 요청. 기준: BE Swagger 10.1 ~ 10.9(https://hangguet.yobistory.com/be/v3/api-docs).
// 그룹 API는 웹 mock 서버에 없어 BE Swagger를 기준으로 한다(사용자 결정 2026-11-12).
import type { Mode, Persona } from "../interview/request";

/** 직군 대분류. DEVELOPMENT 개발 · DATA_AI 데이터·AI · DESIGN 디자인 · PLANNING 기획 · MARKETING 마케팅 · SALES 영업 · MANAGEMENT_SUPPORT 경영지원 · ETC 기타 */
export type JobCategory =
  | "DEVELOPMENT"
  | "DATA_AI"
  | "DESIGN"
  | "PLANNING"
  | "MARKETING"
  | "SALES"
  | "MANAGEMENT_SUPPORT"
  | "ETC";

/** 10.1 POST /interview-groups 본문(Idempotency-Key 필수) */
export interface GroupCreateRequest {
  /** 면접 방식. 참가자 모두 같다 */
  mode: Mode;
  /** 면접관. 참가자 모두 같다 */
  persona: Persona;
  /** 정원(방장 포함) 2 · 3 */
  capacity: number;
  /** 그룹 직군 대분류 */
  jobCategory: JobCategory;
  /** 방장의 면접에 쓸 본인 지원서 id */
  applicationId: number;
}

/** 10.3 POST /interview-groups/join 본문(Idempotency-Key 필수) */
export interface GroupJoinRequest {
  /** 초대 코드 6자리 */
  inviteCode: string;
  /** 내 면접에 쓸 본인 지원서 id */
  applicationId: number;
  /** 내 직군 대분류. 그룹과 달라도 들어갈 수 있다 */
  jobCategory: JobCategory;
}

/** 10.5 PUT /interview-groups/{groupId}/ready 본문 */
export interface ReadyRequest {
  /** true 준비 완료 · false 준비 취소 */
  ready: boolean;
}

/** 10.9 PUT /interview-sessions/{sessionId}/questions/{questionId}/draft 본문(BE Swagger 스키마 이름 DraftRequest) */
export interface AnswerDraftRequest {
  /** 입력 칸의 글 전체(0~1,000자). 최종 답변이 아니다 */
  content: string;
}
