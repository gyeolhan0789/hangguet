"use client";

import { useRef, useTransition } from "react";

import { Avatar } from "@/components/avatar";
import { RETRY_LATER } from "@/lib/messages";
import { PROFILE_IMAGE_ANCHOR } from "@/lib/routes";
import {
  createProfileImageUploadUrl,
  deleteProfileImage,
  registerProfileImage,
} from "@/lib/user/actions";
import { PROFILE_IMAGE_TYPES, profileImageUploadSchema } from "@/lib/user/schemas";
import { useToastStore } from "@/stores/toast-store";

import { OutlineButton, TextButton } from "./settings-ui";

// 기준: Figma S09-1 Row 프로필 사진(18:3186: 아바타 56(user-round 28) · '프로필 사진' 16 Bold · 'JPG · PNG, 5MB 이하' 13 Medium text-3
// · [사진 변경] · '삭제') · Swagger 2.4 업로드 주소 → 브라우저가 uploadUrl로 S3에 PUT → 2.5 등록 · 2.6 삭제
// · 모션 메모 S09-1(18:3261: 업로드 후 아바타 crossfade + 체크 토스트) · 모션 메모 S09(18:3109: S09 ✎ → 이 줄)

/** 사진을 바꾼 뒤 체크 토스트 문구(Figma에 문구가 없어 새로 정함) */
export const PHOTO_CHANGED_TOAST = "프로필 사진을 바꿨어요";

export function ProfilePhotoRow({ imageUrl }: { imageUrl: string | null }) {
  const notify = useToastStore((state) => state.show);
  const input = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [deleting, startDelete] = useTransition();
  const busy = uploading || deleting;

  function upload(file: File) {
    const parsed = profileImageUploadSchema.safeParse({ contentType: file.type, size: file.size });
    if (!parsed.success) {
      notify({ text: parsed.error.issues[0].message });
      return;
    }
    startUpload(async () => {
      const result = await createProfileImageUploadUrl(parsed.data);
      if (!result.upload) {
        notify({ text: result.formError ?? RETRY_LATER });
        return;
      }
      // Presigned URL은 서명할 때와 같은 Content-Type으로 올려야 한다.
      const response = await fetch(result.upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": parsed.data.contentType },
        body: file,
      }).catch(() => null);
      if (!response?.ok) {
        notify({ text: RETRY_LATER });
        return;
      }
      const registered = await registerProfileImage(result.upload.objectKey);
      notify(
        registered.ok
          ? { text: PHOTO_CHANGED_TOAST, icon: "/home/icon-check.svg" }
          : { text: registered.formError ?? RETRY_LATER },
      );
    });
  }

  function remove() {
    startDelete(async () => {
      const result = await deleteProfileImage();
      if (result.formError) notify({ text: result.formError });
    });
  }

  return (
    <div id={PROFILE_IMAGE_ANCHOR} className="flex scroll-mt-24 items-center gap-4 py-[18px]">
      <Avatar imageUrl={imageUrl} size={56} icon="/mypage/icon-user-round-md.svg" iconSize={28} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 leading-normal tracking-[-0.2px]">
        <span className="text-base font-bold text-text-1">프로필 사진</span>
        <span className="text-[13px] font-medium text-text-3">JPG · PNG, 5MB 이하</span>
      </div>
      <input
        ref={input}
        type="file"
        accept={PROFILE_IMAGE_TYPES.join(",")}
        className="hidden"
        aria-label="프로필 사진 파일"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload(file);
        }}
      />
      <OutlineButton
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-busy={uploading || undefined}
      >
        사진 변경
      </OutlineButton>
      <TextButton onClick={remove} disabled={busy} aria-busy={deleting || undefined}>
        삭제
      </TextButton>
    </div>
  );
}
