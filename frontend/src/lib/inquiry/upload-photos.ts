import { RETRY_LATER } from "@/lib/messages";
import { createInquiryPhotoUploadUrls } from "./actions";
import { inquiryPhotosSchema } from "./schemas";

// 기준: Swagger 9.11 문의 사진 업로드 주소 → 브라우저가 uploadUrl로 S3에 PUT → 9.1 · 9.4 attachmentKeys(설정 프로필 사진과 같은 흐름)
// 사진은 [문의 보내기] · [보내기]를 누를 때 한꺼번에 올린다. 고른 뒤 뺀 사진이 S3에 남지 않게 하기 위함이다.

interface UploadedPhotos {
  keys?: string[];
  error?: string;
}

/** 고른 사진을 올리고 9.1 · 9.4에 보낼 키를 고른 순서대로 준다. 사진이 없으면 빈 목록 */
export async function uploadInquiryPhotos(files: File[]): Promise<UploadedPhotos> {
  if (files.length === 0) return { keys: [] };
  const meta = inquiryPhotosSchema.safeParse(
    files.map((file) => ({ contentType: file.type, size: file.size })),
  );
  if (!meta.success) return { error: meta.error.issues[0].message };
  const result = await createInquiryPhotoUploadUrls(meta.data);
  const uploads = result.uploads;
  // 요청한 장수만큼 주소가 와야 사진마다 자기 주소로 올릴 수 있다
  if (uploads?.length !== files.length) return { error: result.error ?? RETRY_LATER };
  // Presigned URL은 서명할 때와 같은 Content-Type으로 올려야 한다.
  const responses = await Promise.all(
    files.map((file, index) =>
      fetch(uploads[index].uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      }).catch(() => null),
    ),
  );
  if (responses.some((response) => !response?.ok)) return { error: RETRY_LATER };
  return { keys: uploads.map((upload) => upload.objectKey) };
}
