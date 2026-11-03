"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import {
  getProblemDetail,
  RETRY_LATER,
  toFormActionResult,
  type FormActionResult,
} from "@/lib/api/problem-detail";
import { inquiryPath } from "@/lib/routes";
import type {
  AttachmentFile,
  AttachmentUploadUrl,
  AttachmentUploadUrlRequest,
  AttachmentUploadUrlResponse,
  InquiryCreateRequest,
  InquiryMessage,
  InquiryPasswordHeaders,
  InquiryQuestionRequest,
  InquiryResponse,
  ProblemDetail,
} from "@/types/api";

import {
  attachmentKeysSchema,
  GUEST_INQUIRY_FIELDS,
  guestInquirySchema,
  guestLookupSchema,
  INQUIRY_FIELDS,
  inquiryMessageSchema,
  inquiryPhotosSchema,
  inquirySchema,
  type GuestInquiryValues,
  type GuestLookupValues,
  type InquiryValues,
} from "./schemas";

// 기준: Swagger 9.1 문의 작성(POST /inquiries → 201 InquiryResponse, 토큰이 있으면 회원 · 없으면 비회원(email · accessPassword 필수))
// · 9.3 문의 조회(GET /inquiries/{id}, 비회원은 X-Inquiry-Password) · 9.4 이어서 쓰기(201 InquiryMessage · 409 INQUIRY_CLOSED)
// · 9.5 종료(204, 이미 종료했어도 204) · 없는 문의 · 남의 문의 · 틀린 조회 비밀번호는 모두 404 INQUIRY_NOT_FOUND
// · 9.11 사진 업로드 주소(토큰 없이) → 9.1 · 9.4 attachmentKeys(400 · 404 FILE_NOT_FOUND는 서버 문구)
// · 기획 메모 I01(→ I03) · I01-B(→ I01-1) · I04(→ I03) · I03 · I03-1
// 회원은 로그인 토큰(쿠키)으로, 비회원은 화면이 들고 있는 조회 비밀번호를 헤더로 보낸다(비회원 화면은 로그인 전에만 열린다).

const INVALID = "입력값을 확인해 주세요.";

const isId = (id: number) => Number.isSafeInteger(id) && id > 0;

// 반환 모양은 InquiryPasswordHeaders(types/api)로 검사하되, axios headers에 넣을 수 있게 객체 리터럴 타입으로 둔다(idempotencyHeaders와 같음).
function passwordHeaders(accessPassword: string) {
  return { "X-Inquiry-Password": accessPassword } satisfies InquiryPasswordHeaders;
}

// 사진 키 400(attachmentKeys)은 폼에 칸이 없어 서버가 준 이유를 그대로 문구로 쓴다
function photoReason(problem: ProblemDetail | null) {
  return problem?.errors?.find(({ field }) => field === "attachmentKeys")?.reason;
}

function withPhotoReason<F extends string>(
  error: unknown,
  result: FormActionResult<F>,
): FormActionResult<F> {
  const reason = photoReason(getProblemDetail(error));
  return reason ? { ...result, formError: reason } : result;
}

// 붙인 사진이 없으면 attachmentKeys를 보내지 않는다(Swagger 9.1 · 9.4)
function withPhotos<T extends object>(body: T, attachmentKeys: string[]) {
  return attachmentKeys.length > 0 ? { ...body, attachmentKeys } : body;
}

export interface PhotoUploadUrls {
  uploads?: AttachmentUploadUrl[];
  error?: string;
}

/** 9.11 사진 업로드 주소. 화면이 받은 주소로 S3에 직접 올린 뒤 objectKey를 9.1 · 9.4에 보낸다 */
export async function createInquiryPhotoUploadUrls(
  files: AttachmentFile[],
): Promise<PhotoUploadUrls> {
  const parsed = inquiryPhotosSchema.safeParse(files);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const body: AttachmentUploadUrlRequest = { files: parsed.data };
  try {
    const { data } = await api.post<AttachmentUploadUrlResponse>(
      endpoints.inquiries.attachmentUploadUrl,
      body,
    );
    return { uploads: data.files };
  } catch (error) {
    unstable_rethrow(error);
    // 400은 이유(errors[].reason)에 형식 · 크기 · 장수 문구가 온다
    const problem = getProblemDetail(error);
    return { error: problem?.errors?.[0]?.reason ?? problem?.detail ?? RETRY_LATER };
  }
}

/** 9.1 문의 작성(회원) → I03 그 문의 */
export async function createInquiry(
  values: InquiryValues,
  attachmentKeys: string[] = [],
): Promise<FormActionResult<keyof InquiryValues>> {
  const parsed = inquirySchema.safeParse(values);
  const keys = attachmentKeysSchema.safeParse(attachmentKeys);
  if (!parsed.success || !keys.success) return { formError: INVALID };
  const body: InquiryCreateRequest = withPhotos(parsed.data, keys.data);
  let data: InquiryResponse;
  try {
    ({ data } = await api.post<InquiryResponse>(endpoints.inquiries.root, body));
  } catch (error) {
    // 401이면 api가 재발급 · 로그아웃 화면으로 redirect한다. 그 신호는 Next가 처리하게 다시 던진다.
    unstable_rethrow(error);
    return withPhotoReason(error, toFormActionResult(error, INQUIRY_FIELDS));
  }
  redirect(inquiryPath(data.id));
}

export interface GuestInquiryCreated {
  inquiryId?: number;
}

/** 9.1 문의 작성(비회원) → I01-1에 보여 줄 문의번호 */
export async function createGuestInquiry(
  values: GuestInquiryValues,
  attachmentKeys: string[] = [],
): Promise<GuestInquiryCreated & FormActionResult<keyof GuestInquiryValues>> {
  const parsed = guestInquirySchema.safeParse(values);
  const keys = attachmentKeysSchema.safeParse(attachmentKeys);
  if (!parsed.success || !keys.success) return { formError: INVALID };
  const body: InquiryCreateRequest = withPhotos(parsed.data, keys.data);
  try {
    const { data } = await api.post<InquiryResponse>(endpoints.inquiries.root, body);
    return { inquiryId: data.id };
  } catch (error) {
    unstable_rethrow(error);
    return withPhotoReason(error, toFormActionResult(error, GUEST_INQUIRY_FIELDS));
  }
}

export interface GuestInquiryOpened {
  inquiry?: InquiryResponse;
}

/**
 * 9.3 문의 조회(비회원). 조회 비밀번호가 화면(I04 입력 · 접수 직후 메모리)에만 있어 서버 컴포넌트가 아니라 이 서버 액션으로 부른다.
 * 없는 문의 · 틀린 조회 비밀번호(404)는 서버 문구를 폼 아래에 보여 준다.
 */
export async function openGuestInquiry(
  values: GuestLookupValues,
): Promise<GuestInquiryOpened & FormActionResult<keyof GuestLookupValues>> {
  const parsed = guestLookupSchema.safeParse(values);
  if (!parsed.success) return { formError: INVALID };
  try {
    const { data } = await api.get<InquiryResponse>(
      endpoints.inquiries.detail(Number(parsed.data.inquiryId)),
      { headers: passwordHeaders(parsed.data.accessPassword) },
    );
    return { inquiry: data };
  } catch (error) {
    unstable_rethrow(error);
    return toFormActionResult(error, ["inquiryId", "accessPassword"] as const);
  }
}

export interface InquiryWriteResult {
  message?: InquiryMessage;
  ok?: true;
  error?: string;
  /** 404 INQUIRY_NOT_FOUND(없거나 남의 문의 · 틀린 조회 비밀번호) */
  notFound?: true;
  /** 409 INQUIRY_CLOSED(그 사이 종료한 문의). 화면을 종료 상태로 다시 그린다 */
  closed?: true;
}

function writeFailure(error: unknown): InquiryWriteResult {
  const problem = getProblemDetail(error);
  return {
    error: photoReason(problem) ?? problem?.detail ?? RETRY_LATER,
    ...(problem?.code === "INQUIRY_NOT_FOUND" && { notFound: true as const }),
    ...(problem?.code === "INQUIRY_CLOSED" && { closed: true as const }),
  };
}

/**
 * 9.4 문의 이어서 쓰기. 회원이면 accessPassword 없이 부르고 I03을 다시 그린다(refresh).
 * 비회원은 응답 메시지만 오므로 화면이 9.3을 다시 불러 상태까지 바꾼다.
 */
export async function addInquiryMessage(
  inquiryId: number,
  question: InquiryQuestionRequest,
  accessPassword?: string,
): Promise<InquiryWriteResult> {
  const parsed = inquiryMessageSchema.safeParse({ content: question.content });
  const keys = attachmentKeysSchema.safeParse(question.attachmentKeys ?? []);
  if (!isId(inquiryId) || !parsed.success || !keys.success) return { error: INVALID };
  const body: InquiryQuestionRequest = withPhotos(parsed.data, keys.data);
  try {
    const { data } = await api.post<InquiryMessage>(endpoints.inquiries.messages(inquiryId), body, {
      ...(accessPassword && { headers: passwordHeaders(accessPassword) }),
    });
    if (!accessPassword) refresh();
    return { message: data };
  } catch (error) {
    unstable_rethrow(error);
    const failure = writeFailure(error);
    // 그 사이 종료됐으면 회원 I03을 다시 그려 입력칸 대신 '종료한 문의예요.'를 보인다
    if (failure.closed && !accessPassword) refresh();
    return failure;
  }
}

/** 9.5 문의 종료. 이미 종료했어도 성공. 회원이면 I03을 다시 그린다 */
export async function closeInquiry(
  inquiryId: number,
  accessPassword?: string,
): Promise<InquiryWriteResult> {
  if (!isId(inquiryId)) return { error: INVALID };
  try {
    await api.post(endpoints.inquiries.close(inquiryId), undefined, {
      ...(accessPassword && { headers: passwordHeaders(accessPassword) }),
    });
  } catch (error) {
    unstable_rethrow(error);
    return writeFailure(error);
  }
  if (!accessPassword) refresh();
  return { ok: true };
}
