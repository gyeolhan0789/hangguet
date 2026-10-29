// 4. 지원서 요청. 기준: Swagger 4.1 · 4.3 · 4.6 · ERD cover_letter_items.
import type { PageQuery } from "../common";

/** 4.1 자기소개서 문항 하나 */
export interface CoverLetterItemRequest {
  /** 기업이 낸 문항 질문. 1~255자 */
  question: string;
  /** 답변. 1~20,000자 */
  answer: string;
}

/** 4.1 POST /applications 본문 */
export interface ApplicationCreateRequest {
  /** 지원 회사명. 필수, 최대 100자(화면은 빈 값을 막는다) */
  companyName: string;
  /** 지원 직무. 필수, 최대 100자(화면은 빈 값을 막는다) */
  jobTitle: string;
  /** 자기소개서 문항 1~5개. 보낸 순서가 문항 순서(1부터) */
  coverLetterItems: CoverLetterItemRequest[];
}

/** 4.2 · 4.5 · 4.6 경로 값 */
export interface ApplicationPath {
  /** 지원서 id. Swagger: `0`이면 404(뼈대 서버) */
  applicationId: number;
}

/** 4.3 GET /applications 쿼리. page 기본 0, size 기본 10(1~20) */
export type ApplicationListQuery = PageQuery;

/** 4.6 GET /applications/{applicationId}/interview-sessions 쿼리. page 기본 0, size 기본 10(1~20) */
export type ApplicationSessionListQuery = PageQuery;
