// 4. 지원서 응답. 기준: Swagger 4.1 ~ 4.6 · ERD cover_letter_items.
import type { OffsetDateTime, Page } from "../common";
import type { SessionListItem } from "../interview/response";

/** 저장된 자기소개서 문항 하나 */
export interface CoverLetterItem {
  /** 문항 순서(1부터) */
  itemOrder: number;
  /** 문항 질문 */
  question: string;
  /** 답변 */
  answer: string;
}

/** 4.1 지원서 작성(201) · 4.2 조회(200) */
export interface ApplicationResponse {
  /** 지원서 id. 면접 만들기(5.1)의 applicationId */
  id: number;
  /** 지원 회사명 */
  companyName: string;
  /** 지원 직무 */
  jobTitle: string;
  /** 자기소개서 문항. 문항 순서대로 */
  coverLetterItems: CoverLetterItem[];
  /** 작성 일시 */
  createdAt: OffsetDateTime;
}

/** 지원서 목록 한 줄 */
export interface ApplicationListItem {
  /** 지원서 id */
  id: number;
  /** 지원 회사명 */
  companyName: string;
  /** 지원 직무 */
  jobTitle: string;
  /** 작성 일시 */
  createdAt: OffsetDateTime;
}

/** 4.3 지원서 목록 (200) */
export type ApplicationListResponse = Page<ApplicationListItem>;

// 4.5 지원서 삭제는 204(본문 없음)

/** 4.6 지원서의 연습 면접 목록 (200). 항목은 5.13과 같고, 면접이 없으면 빈 content */
export type ApplicationSessionListResponse = Page<SessionListItem>;
