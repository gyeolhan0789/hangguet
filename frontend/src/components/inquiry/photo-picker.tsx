"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import { MaskIcon } from "@/components/mask-icon";
import {
  INQUIRY_PHOTO_MAX,
  INQUIRY_PHOTO_TYPES,
  inquiryPhotoSchema,
  PHOTO_COUNT,
} from "@/lib/inquiry/schemas";

// 기준: Swagger 9.11(JPG · PNG, 5MB 이하, 메시지당 5장) · 사용자 결정(2026-11-03: Figma에 없어 사진 칸 방식을 쓴다)
// · 참고: Ant Design Upload picture-card · MYDS File upload

const PHOTO_HINT = "JPG · PNG, 5MB 이하 · 최대 5장";
// 커서는 이웃 버튼(inquiry-button-class)과 같다
const tileButton =
  "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40";
export const PHOTO_ACCEPT = INQUIRY_PHOTO_TYPES.join(",");

export interface PickedPhoto {
  id: number;
  file: File;
  /** 미리보기 주소(URL.createObjectURL). 빼거나 화면을 떠나면 해제한다 */
  url: string;
}

/** 고른 사진 목록. 형식 · 크기 · 장수가 맞지 않는 사진은 빼고 그 이유를 error로 준다 */
export function usePhotoPicks() {
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<string>();
  const nextId = useRef(0);
  const latest = useRef<PickedPhoto[]>([]);

  useEffect(() => {
    latest.current = photos;
  }, [photos]);
  useEffect(
    () => () => {
      for (const photo of latest.current) URL.revokeObjectURL(photo.url);
    },
    [],
  );

  function add(files: File[]) {
    let reason: string | undefined;
    const room = INQUIRY_PHOTO_MAX - photos.length;
    const valid = files.filter((file) => {
      const parsed = inquiryPhotoSchema.safeParse({ contentType: file.type, size: file.size });
      if (!parsed.success) reason ??= parsed.error.issues[0].message;
      return parsed.success;
    });
    if (valid.length > room) reason = PHOTO_COUNT;
    const picked = valid.slice(0, Math.max(room, 0)).map((file) => ({
      id: nextId.current++,
      file,
      url: URL.createObjectURL(file),
    }));
    setError(reason);
    if (picked.length > 0) setPhotos([...photos, ...picked]);
  }

  function remove(id: number) {
    const photo = photos.find((p) => p.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    setError(undefined);
    setPhotos(photos.filter((p) => p.id !== id));
  }

  function clear() {
    for (const photo of photos) URL.revokeObjectURL(photo.url);
    setError(undefined);
    setPhotos([]);
  }

  /** 파일 입력칸 onChange. 같은 파일을 다시 고를 수 있게 값을 비운다 */
  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) add(files);
  }

  return {
    photos,
    files: photos.map((p) => p.file),
    error,
    full: photos.length >= INQUIRY_PHOTO_MAX,
    onInputChange,
    remove,
    clear,
  };
}

/** 고른 사진 칸. onAdd가 있으면 5장이 될 때까지 끝에 '추가' 칸을 둔다 */
export function PhotoTiles({
  photos,
  onRemove,
  onAdd,
  disabled = false,
}: {
  photos: PickedPhoto[];
  onRemove: (id: number) => void;
  onAdd?: () => void;
  disabled?: boolean;
}) {
  return (
    <ul aria-label="고른 사진" className="flex flex-wrap gap-2.5 pt-1.5">
      {photos.map((photo, index) => (
        <li key={photo.id} className="relative size-[72px]">
          <span
            role="img"
            aria-label={`고른 사진 ${index + 1}`}
            className="block size-full rounded-xl border border-line bg-surface bg-cover bg-center"
            style={{ backgroundImage: `url("${photo.url}")` }}
          />
          <button
            type="button"
            aria-label={`사진 ${index + 1} 빼기`}
            disabled={disabled}
            onClick={() => onRemove(photo.id)}
            className={`absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-text-1 ${tileButton}`}
          >
            <MaskIcon src="/review/icon-x.svg" size={14} className="bg-bg" />
          </button>
        </li>
      ))}
      {onAdd && photos.length < INQUIRY_PHOTO_MAX && (
        <li>
          <button
            type="button"
            disabled={disabled}
            onClick={onAdd}
            aria-label="사진 추가"
            className={`flex size-[72px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-text-3/50 bg-bg-sub text-xs leading-normal font-semibold text-text-3 ${tileButton}`}
          >
            <MaskIcon src="/inquiry/icon-image-plus.svg" size={22} className="bg-text-3" />
            추가
          </button>
        </li>
      )}
    </ul>
  );
}

/** I01 · I01-B '사진' 칸. 장수는 제목 칸 카운터처럼 아래 오른쪽에 둔다 */
export function PhotoField({
  picks,
  disabled = false,
}: {
  picks: ReturnType<typeof usePhotoPicks>;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      className="flex flex-col gap-1.5"
    >
      <span id={`${id}-label`} className="text-[13px] leading-normal font-bold text-text-2">
        사진
      </span>
      <input
        ref={input}
        type="file"
        aria-label="사진 파일"
        accept={PHOTO_ACCEPT}
        multiple
        className="hidden"
        onChange={picks.onInputChange}
      />
      <PhotoTiles
        photos={picks.photos}
        onRemove={picks.remove}
        onAdd={() => input.current?.click()}
        disabled={disabled}
      />
      <p
        id={`${id}-hint`}
        className="flex justify-between gap-2 text-[13px] leading-normal font-medium text-text-3"
      >
        <span>{PHOTO_HINT}</span>
        <span>
          {picks.photos.length} / {INQUIRY_PHOTO_MAX}
        </span>
      </p>
      {picks.error && (
        <p role="alert" className="text-xs leading-normal font-semibold text-danger">
          {picks.error}
        </p>
      )}
    </div>
  );
}
