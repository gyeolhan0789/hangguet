// 4. 지원서 응답. 기준: mock ApplicationDtos · ApplicationController.
import type { OffsetDateTime, Page } from "../common";

/** 4.1 지원서 작성(201) · 4.2 조회(200) · 4.4 수정(200) */
export interface ApplicationResponse {
  /** 지원서 id. 면접 만들기(5.1)의 applicationId */
  id: number;
  /** 지원 회사명 */
  companyName: string;
  /** 지원 직무 */
  jobTitle: string;
  /** 자기소개서 */
  coverLetter: string;
  /** 작성 일시 */
  createdAt: OffsetDateTime;
  /** 면접에 쓴 적이 있으면 true(수정 · 삭제 불가). 새로 만들면 false */
  inUse: boolean;
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
  /** 면접에 쓴 적이 있으면 true → 화면은 수정 · 삭제 버튼을 끈다 */
  inUse: boolean;
}

/** 4.3 지원서 목록 (200) */
export type ApplicationListResponse = Page<ApplicationListItem>;

// 4.5 지원서 삭제는 204(본문 없음)
