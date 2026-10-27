// 9. 문의 요청(회원 · 비회원). 기준: Swagger 9.1 문의 작성 · 9.4 문의 이어서 쓰기 · 9.2 내 문의 목록 · 9.3 · 9.5.
// 관리자 9.6 ~ 9.10은 관리 페이지(admin)에서만 쓴다.

/**
 * 9.1 POST /inquiries 본문. 로그인했으면 회원 문의(email · accessPassword는 보내지 않는다),
 * 로그인하지 않았으면 비회원 문의(둘 다 필수)
 */
export interface InquiryCreateRequest {
  /** 문의 제목. 필수, 최대 100자 */
  title: string;
  /** 첫 질문 본문. 필수 */
  content: string;
  /** 비회원만: 답변 확인 · 본인 확인에 쓰는 이메일. 최대 255자 */
  email?: string | null;
  /** 비회원만: 문의를 다시 볼 때 쓰는 조회 비밀번호(4~20자) */
  accessPassword?: string | null;
}

/** 9.4 POST /inquiries/{inquiryId}/messages 본문 */
export interface InquiryMessageRequest {
  /** 질문 본문. 필수 */
  content: string;
}

/**
 * 9.3 · 9.4 · 9.5 비회원 문의 요청 헤더. 9.1에서 정한 조회 비밀번호.
 * 회원은 보내지 않고 로그인 토큰으로 부른다
 */
export interface InquiryPasswordHeaders {
  "X-Inquiry-Password": string;
}

// 9.2 GET /inquiries 쿼리는 PageQuery(page 0부터 · size 1~20, 기본 10)
