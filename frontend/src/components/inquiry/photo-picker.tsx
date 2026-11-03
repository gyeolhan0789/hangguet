"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type ComponentProps } from "react";

import { MaskIcon } from "@/components/mask-icon";
import {
  INQUIRY_PHOTO_MAX,
  INQUIRY_PHOTO_TYPES,
  inquiryPhotoSchema,
  PHOTO_COUNT,
} from "@/lib/inquiry/schemas";

// 기준: Swagger 9.11(JPG · PNG, 5MB 이하, 메시지당 5장) · 사용자 결정(2026-11-03: Figma에 없어
// 첫 문의(I01 · I01-B)는 내용 아래 사진 칸(끝에 '추가' 칸), 이어서 쓰기(I03)는 채팅 입력창처럼 상자 안 사진 버튼 · 글 위 사진)
// · 참고: Ant Design Upload picture-card · LibreChat Composer(첨부는 글 위) · Stream Chat 첨부 미리보기(모서리 빼기, 작게)

const PHOTO_HINT = "JPG · PNG, 5MB 이하 · 최대 5장";
// 커서는 이웃 버튼(inquiry-button-class)과 같다
const iconButton =
  "flex cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40";
const PHOTO_ACCEPT = INQUIRY_PHOTO_TYPES.join(",");

interface PickedPhoto {
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

/** 고른 사진. 칸 안 오른쪽 위에 빼기 버튼, onAdd가 있으면 5장이 될 때까지 끝에 '추가' 칸 */
function PhotoTiles({
  photos,
  onRemove,
  onAdd,
  disabled,
  sizeClass,
}: {
  photos: PickedPhoto[];
  onRemove: (id: number) => void;
  onAdd?: () => void;
  disabled: boolean;
  sizeClass: string;
}) {
  return (
    <ul aria-label="고른 사진" className="flex flex-wrap gap-2">
      {photos.map((photo, index) => (
        <li key={photo.id} className={`relative ${sizeClass}`}>
          <span
            role="img"
            aria-label={`고른 사진 ${index + 1}`}
            className="block size-full rounded-lg border border-line bg-surface bg-cover bg-center"
            style={{ backgroundImage: `url("${photo.url}")` }}
          />
          <button
            type="button"
            aria-label={`사진 ${index + 1} 빼기`}
            disabled={disabled}
            onClick={() => onRemove(photo.id)}
            className={`absolute top-1 right-1 size-5 rounded-full bg-black/60 ${iconButton}`}
          >
            <MaskIcon src="/review/icon-x.svg" size={12} className="bg-white" />
          </button>
        </li>
      ))}
      {onAdd && photos.length < INQUIRY_PHOTO_MAX && (
        <li>
          <button
            type="button"
            aria-label="사진 추가"
            disabled={disabled}
            onClick={onAdd}
            className={`${sizeClass} flex-col gap-1 rounded-lg border border-dashed border-text-3/50 bg-bg-sub text-xs leading-normal font-semibold text-text-3 ${iconButton}`}
          >
            <MaskIcon src="/inquiry/icon-image-plus.svg" size={22} className="bg-text-3" />
            추가
          </button>
        </li>
      )}
    </ul>
  );
}

/** I01 · I01-B 내용 아래 '사진' 칸. 장수는 제목 칸 카운터처럼 아래 오른쪽에 둔다 */
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
        accept={PHOTO_ACCEPT}
        multiple
        className="hidden"
        aria-label="사진 파일"
        onChange={picks.onInputChange}
      />
      <PhotoTiles
        photos={picks.photos}
        onRemove={picks.remove}
        onAdd={() => input.current?.click()}
        disabled={disabled}
        sizeClass="size-[72px]"
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

/** I03 이어서 쓰기 입력 상자. 고른 사진은 글 위, 사진 버튼과 안내(고르면 장수)는 아래. 테두리는 TextArea와 같다 */
export function PhotoComposer({
  picks,
  invalid = false,
  disabled = false,
  heightClass,
  ...textarea
}: ComponentProps<"textarea"> & {
  picks: ReturnType<typeof usePhotoPicks>;
  invalid?: boolean;
  disabled?: boolean;
  /** 글 칸 높이 */
  heightClass: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const count = picks.photos.length;
  return (
    <div
      className={`flex flex-col rounded-xl border bg-bg-sub transition-colors focus-within:border-brand focus-within:ring-1 focus-within:ring-brand ${
        invalid ? "border-danger ring-1 ring-danger" : "border-line"
      }`}
    >
      {count > 0 && (
        <div className="px-3 pt-3">
          <PhotoTiles
            photos={picks.photos}
            onRemove={picks.remove}
            disabled={disabled}
            sizeClass="size-16"
          />
        </div>
      )}
      <textarea
        aria-invalid={invalid || undefined}
        aria-describedby={textarea.id ? `${textarea.id}-message` : undefined}
        className={`w-full resize-none bg-transparent px-4 pt-3.5 text-[15px] leading-normal font-semibold text-text-1 outline-none placeholder:font-medium placeholder:text-text-3 ${heightClass}`}
        {...textarea}
      />
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <input
          ref={input}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          className="hidden"
          aria-label="사진 파일"
          onChange={picks.onInputChange}
        />
        <button
          type="button"
          aria-label="사진 붙이기"
          disabled={disabled || picks.full}
          onClick={() => input.current?.click()}
          className={`size-9 rounded-lg hover:bg-surface ${iconButton}`}
        >
          <MaskIcon src="/inquiry/icon-image-plus.svg" size={20} className="bg-text-3" />
        </button>
        <span className="text-xs leading-normal font-medium text-text-3">
          {count > 0 ? `사진 ${count} / ${INQUIRY_PHOTO_MAX}` : PHOTO_HINT}
        </span>
      </div>
    </div>
  );
}
