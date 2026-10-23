// 4. 지원서 요청. 기준: 웹 Swagger 4.1 · 4.3 · 4.4.
import type { PageQuery } from "../common";

/** 4.1 POST /applications 본문 */
export interface ApplicationCreateRequest {
  /** 지원 회사명. 필수, 최대 100자(화면은 빈 값을 막는다) */
  companyName: string;
  /** 지원 직무. 필수, 최대 100자(화면은 빈 값을 막는다) */
  jobTitle: string;
  /** 자기소개서(문항과 답변). 필수, 최대 3,000자(화면은 빈 값을 막는다) */
  coverLetter: string;
}

/** 4.4 PATCH /applications/{applicationId} 본문. 보낸 필드만 바꾼다 */
export interface ApplicationUpdateRequest {
  /** 지원 회사명. 1~100자 */
  companyName?: string | null;
  /** 지원 직무. 1~100자 */
  jobTitle?: string | null;
  /** 자기소개서. 1~3,000자 */
  coverLetter?: string | null;
}

/** 4.2 · 4.4 · 4.5 경로 값 */
export interface ApplicationPath {
  /** 지원서 id. 웹 Swagger: `0`이면 404(뼈대 서버) */
  applicationId: number;
}

/** 4.3 GET /applications 쿼리. page 기본 0, size 기본 10(1~20) */
export type ApplicationListQuery = PageQuery;
