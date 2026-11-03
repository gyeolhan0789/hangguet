// 9. 문의 응답(회원 · 비회원). 기준: Swagger 9.1 ~ 9.5 · 9.11 · 스키마 InquiryResponse · InquiryListItem · InquiryMessage.
import type { OffsetDateTime, Page } from "../common";

/** 문의 상태. WAITING 답변 대기 · ANSWERED 답변함 · CLOSED 종료 */
export type InquiryStatus = "WAITING" | "ANSWERED" | "CLOSED";

/** 메시지를 쓴 사람. USER 문의한 사람 · ADMIN 관리자 */
export type InquiryAuthorType = "USER" | "ADMIN";

/** 메시지에 붙인 사진 */
export interface InquiryAttachment {
  /** 사진 id */
  id: number;
  /** 사진을 받는 임시 주소(1시간) */
  url: string;
}

/** 문의 메시지 하나(질문 또는 답변). 9.4 응답(201)이기도 하다 */
export interface InquiryMessage {
  /** 메시지 id */
  id: number;
  /** 쓴 사람 */
  authorType: InquiryAuthorType;
  /** 본문 */
  content: string;
  /** 쓴 일시 */
  createdAt: OffsetDateTime;
  /** 붙인 사진. 붙인 순. 없으면 빈 목록 */
  attachments: InquiryAttachment[];
}

/** 9.1 문의 작성(201) · 9.3 문의 조회(200). 문의 id가 곧 문의번호다 */
export interface InquiryResponse {
  /** 문의 id(문의번호) */
  id: number;
  /** 문의 제목 */
  title: string;
  /** 상태 */
  status: InquiryStatus;
  /** 문의한 일시 */
  createdAt: OffsetDateTime;
  /** 마지막으로 질문 · 답변이 달리거나 종료한 일시 */
  updatedAt: OffsetDateTime;
  /** 주고받은 메시지. 오래된 순 */
  messages: InquiryMessage[];
}

/** 9.2 내 문의 목록의 한 줄. 메시지는 빠져 있다(9.3으로 조회) */
export type InquiryListItem = Omit<InquiryResponse, "messages">;

/** 9.2 내 문의 목록(200). 최근 작성순 */
export type InquiryListResponse = Page<InquiryListItem>;

/** 9.11 사진 하나의 업로드 주소 */
export interface AttachmentUploadUrl {
  /** 파일을 PUT할 임시 주소 */
  uploadUrl: string;
  /** 올린 파일의 키. 9.1 · 9.4의 attachmentKeys에 그대로 보낸다 */
  objectKey: string;
  /** uploadUrl 만료 일시 */
  expiresAt: OffsetDateTime;
}

/** 9.11 사진 업로드 주소(200). 요청한 순서대로 */
export interface AttachmentUploadUrlResponse {
  files: AttachmentUploadUrl[];
}

// 9.5 문의 종료는 204(본문 없음)
