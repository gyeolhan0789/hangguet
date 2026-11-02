import { z } from "zod";

import { PASSWORD_MAX, PASSWORD_RULES } from "@/lib/auth/schemas";
import type {
  NicknameRequest,
  PasswordChangeRequest,
  PracticeAlarmTimeRequest,
  ProfileImageContentType,
  ProfileImageRequest,
  ProfileImageUploadUrlRequest,
  WithdrawRequest,
} from "@/types/api";

// 기준: 웹 Swagger 2.2 닉네임 변경(NicknameRequest: 최대 50자 · 앞뒤 공백 제거) · 2.3 비밀번호 변경(PasswordChangeRequest:
// currentPassword 최대 64자, newPassword 8~64자 · 영문 · 숫자 각 1자 이상) · 2.4 프로필 사진 업로드 주소
// (ProfileImageUploadUrlRequest: JPG · PNG, 1~5,242,880바이트) · 2.5 프로필 사진 등록(objectKey 1자 이상)
// · 2.7 회원 탈퇴(WithdrawRequest: password 최대 64자) · 2.10 연습 알림 시각 변경(PracticeAlarmTimeRequest: HH:mm, 00:00~23:59)
// 설정 화면(S09-1)에는 Figma 검증 문구가 없어, 새 비밀번호 문구는 웹 Swagger 1.2 VALIDATION_FAILED reason과 같게 쓴다.
// 빈 값(공백만 넣은 값 포함)은 서버로 보내기 전에 화면에서 먼저 막는다. 폼(클라이언트)과 서버 액션이 같이 쓴다.
// 각 스키마는 satisfies로 Swagger 요청 타입과 묶여, 어느 한쪽이 바뀌면 컴파일 오류가 난다.

const REQUIRED = "필수 값입니다.";
const notBlank = (value: string) => value.trim().length > 0;

export const nicknameSchema = z.object({
  nickname: z.string().trim().min(1, REQUIRED).max(50, "1~50자입니다."),
}) satisfies z.ZodType<NicknameRequest>;

const NEW_PASSWORD_RULE = "8~64자, 영문과 숫자를 모두 포함해야 합니다.";

export const passwordChangeSchema = z.object({
  currentPassword: z
    .string()
    .refine(notBlank, REQUIRED)
    .refine((value) => value.length <= PASSWORD_MAX, "최대 64자입니다."),
  newPassword: z
    .string()
    .refine(
      (value) => value.length <= PASSWORD_MAX && PASSWORD_RULES.every((rule) => rule.test(value)),
      NEW_PASSWORD_RULE,
    ),
}) satisfies z.ZodType<PasswordChangeRequest>;

/** 2.10 알림 시각. 웹 Swagger PracticeAlarmTimeRequest.time pattern ^([01]\d|2[0-3]):[0-5]\d$ */
export const practiceAlarmTimeSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm 형식(00:00~23:59)입니다."),
}) satisfies z.ZodType<PracticeAlarmTimeRequest>;

export const withdrawSchema = z.object({
  password: z
    .string()
    .refine(notBlank, REQUIRED)
    .refine((value) => value.length <= PASSWORD_MAX, "최대 64자입니다."),
}) satisfies z.ZodType<WithdrawRequest>;

/** 프로필 사진으로 올릴 수 있는 형식(2.4). Record라 타입에 형식이 늘거나 줄면 컴파일 오류가 난다. */
const PROFILE_IMAGE_TYPE_RECORD = {
  "image/jpeg": true,
  "image/png": true,
} satisfies Record<ProfileImageContentType, true>;

export const PROFILE_IMAGE_TYPES = Object.keys(
  PROFILE_IMAGE_TYPE_RECORD,
) as ProfileImageContentType[];

/** 프로필 사진 최대 크기(2.4 size 최대 5,242,880바이트 = 5MB) */
export const PROFILE_IMAGE_MAX_BYTES = 5_242_880;

export const profileImageUploadSchema = z.object({
  contentType: z.enum(PROFILE_IMAGE_TYPES, "JPG·PNG만 올릴 수 있습니다."),
  size: z
    .number()
    .int()
    .min(1, "1바이트 이상입니다.")
    .max(PROFILE_IMAGE_MAX_BYTES, "5MB 이하만 올릴 수 있습니다."),
}) satisfies z.ZodType<ProfileImageUploadUrlRequest>;

export const objectKeySchema = z.string().refine(notBlank, REQUIRED) satisfies z.ZodType<
  ProfileImageRequest["objectKey"]
>;

export type NicknameValues = z.infer<typeof nicknameSchema>;
export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;
export type WithdrawValues = z.infer<typeof withdrawSchema>;
export type PracticeAlarmTimeValues = z.infer<typeof practiceAlarmTimeSchema>;
export type ProfileImageUploadValues = z.infer<typeof profileImageUploadSchema>;
