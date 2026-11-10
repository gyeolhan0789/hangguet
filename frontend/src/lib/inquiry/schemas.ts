import { z } from "zod";

// 기준: Swagger 9.1 문의 작성(InquiryCreateRequest: title 필수 · 최대 100자, content 필수, 비회원은 email(형식 · 최대 255자)
// · accessPassword(4~20자) 필수) · 9.4 이어서 쓰기(InquiryQuestionRequest: content 필수) · 9.3 문의 조회(경로 문의 id · X-Inquiry-Password)
// · 본문(content) 최대 2,000자(9.1 · 9.4 · 9.8 공통) · 9.11 사진 업로드 주소(AttachmentFile: JPG · PNG, 1바이트~5MB, 한 번에 1~5장) · attachmentKeys 최대 5개
// 오류 문구는 서버(400 VALIDATION_FAILED errors[].reason)와 같다. 폼(클라이언트)과 서버 액션이 같이 쓴다.

export const INQUIRY_TITLE_MAX = 100;
/** 문의 본문 최대 글자 수(9.1 · 9.4 content, 서버와 같음) */
export const INQUIRY_CONTENT_MAX = 2000;
const REQUIRED = "필수 값입니다.";

const title = z.string().trim().min(1, REQUIRED).max(INQUIRY_TITLE_MAX, "최대 100자입니다.");
const content = z.string().trim().min(1, REQUIRED).max(INQUIRY_CONTENT_MAX, "최대 2,000자입니다.");
const accessPassword = z.string().min(1, REQUIRED).min(4, "4~20자입니다.").max(20, "4~20자입니다.");

/** I01 문의하기(회원) */
export const inquirySchema = z.object({ title, content });
export type InquiryValues = z.infer<typeof inquirySchema>;
export const INQUIRY_FIELDS = inquirySchema.keyof().options;

/** I01-B 문의하기(비회원) */
export const guestInquirySchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, REQUIRED)
    .max(255, "최대 255자입니다.")
    .email("이메일 형식이 아닙니다."),
  accessPassword,
  title,
  content,
});
export type GuestInquiryValues = z.infer<typeof guestInquirySchema>;
export const GUEST_INQUIRY_FIELDS = guestInquirySchema.keyof().options;

/**
 * I01-B 폼: 9.1 본문에 개인정보 수집 · 이용 동의를 더한다(「개인정보 보호법」 제15조 · 사용자 결정 2026-10-30).
 * 동의는 9.1이 받지 않으므로 서버에 보내지 않고 화면에서만 확인한다.
 */
export const guestInquiryFormSchema = guestInquirySchema.extend({
  agreed: z.boolean().refine((value) => value, "개인정보 수집 · 이용에 동의해 주세요."),
});
export type GuestInquiryFormValues = z.infer<typeof guestInquiryFormSchema>;

/** I04 비회원 문의 확인: 문의번호(양의 정수) · 조회 비밀번호 */
export const guestLookupSchema = z.object({
  inquiryId: z
    .string()
    .trim()
    .min(1, REQUIRED)
    .regex(/^[1-9]\d{0,15}$/, "문의를 찾을 수 없어요."),
  accessPassword,
});
export type GuestLookupValues = z.infer<typeof guestLookupSchema>;

export const INQUIRY_PHOTO_MAX = 5;
export const INQUIRY_PHOTO_TYPES = ["image/jpeg", "image/png"] as const;
const INQUIRY_PHOTO_MAX_BYTES = 5_242_880;
export const PHOTO_COUNT = "사진은 5장까지 붙일 수 있습니다.";

/** 9.11 사진 하나(형식 · 크기) */
export const inquiryPhotoSchema = z.object({
  contentType: z.enum(INQUIRY_PHOTO_TYPES, "JPG·PNG만 올릴 수 있습니다."),
  size: z
    .number()
    .int()
    .min(1, "1바이트 이상입니다.")
    .max(INQUIRY_PHOTO_MAX_BYTES, "5MB 이하만 올릴 수 있습니다."),
});

/** 9.11 한 번에 올릴 사진들 */
export const inquiryPhotosSchema = z
  .array(inquiryPhotoSchema)
  .min(1, REQUIRED)
  .max(INQUIRY_PHOTO_MAX, PHOTO_COUNT);

/** 9.1 · 9.4 attachmentKeys */
export const attachmentKeysSchema = z.array(z.string().min(1)).max(INQUIRY_PHOTO_MAX, PHOTO_COUNT);

/** I03 이어서 쓰기 */
export const inquiryMessageSchema = z.object({ content });
export type InquiryMessageValues = z.infer<typeof inquiryMessageSchema>;
