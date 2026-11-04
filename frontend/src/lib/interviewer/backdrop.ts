import { ImageLoader, SRGBColorSpace, Texture, type Scene } from "three";

import { download } from "./download";
import { withRetry } from "./retry";

// 면접관 뒤에 까는 배경 그림(커피챗 = 카페). 장면 배경으로 두고 CSS background-size: cover처럼 화면을 채운다.
// 기준: 기획 메모 S06(18:757: 배경 씬은 페르소나별 — 커피챗 = 카페) · 사용자 결정(2026-10-26: 카페 실내 그림 1장, 낮 창가 햇빛,
// 배경도 모델처럼 이전 화면에서 미리 받는다) · three.js 매뉴얼 How to dispose of objects
// · 사용자 결정(2026-11-04: 배경도 모델처럼 받다가 멈추면 끊고 다시 받는다 — download.ts · retry.ts)

export interface Backdrop {
  /** 화면 크기가 바뀌면 그림을 다시 맞춘다. */
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

type BackdropImage = HTMLImageElement | ImageBitmap;

/** 받은(받는 중인) 그림. 미리 받아 둔 그림을 장면이 다시 받지 않고 바로 쓴다. 실패하면 지워 다음에 다시 받는다. */
const images = new Map<string, Promise<BackdropImage>>();

/** 받은 내용을 그림으로 푼다. 다 풀면 임시 주소를 놓는다 */
function decodeImage(buffer: ArrayBuffer): Promise<BackdropImage> {
  const objectUrl = URL.createObjectURL(new Blob([buffer]));
  return new Promise<BackdropImage>((resolve, reject) => {
    new ImageLoader().load(objectUrl, resolve, undefined, reject);
  }).finally(() => URL.revokeObjectURL(objectUrl));
}

/** 그림을 받는다. 실패 상태에 따라 다시 받고(withRetry), 받다가 멈추면 끊고 다시 받는다(download) */
function loadImage(url: string): Promise<BackdropImage> {
  let image = images.get(url);
  if (!image) {
    image = withRetry(() => download(url)).then(decodeImage);
    image.catch(() => images.delete(url));
    images.set(url, image);
  }
  return image;
}

/** 배경 그림을 미리 받아 둔다(이전 화면). 실패하면 거부한다. */
export async function preloadBackdrop(url: string): Promise<void> {
  await loadImage(url);
}

/** 그림을 화면 비율에 맞춰 넘치는 쪽을 가운데 기준으로 잘라 낸다. */
function fitCover(texture: Texture, viewAspect: number) {
  const image = texture.image as BackdropImage | undefined;
  if (!image?.width || !image.height) return;
  const imageAspect = image.width / image.height;
  if (viewAspect > imageAspect) texture.repeat.set(1, imageAspect / viewAspect);
  else texture.repeat.set(viewAspect / imageAspect, 1);
  texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
}

/**
 * 배경 그림을 장면 배경으로 둔다. 미리 받아 두었으면 첫 장면 전에 깔리고, 아니면 다 받은 뒤 onLoad로 알려 다시 그리게 한다.
 * 그림을 받지 못하면 배경 없이 그린다(면접은 계속).
 */
export function setupBackdrop({
  scene,
  url,
  onLoad,
}: {
  scene: Scene;
  url: string;
  onLoad: () => void;
}): Backdrop {
  let texture: Texture | null = null;
  let viewAspect = 1;
  let disposed = false;

  loadImage(url).then(
    (image) => {
      if (disposed) return;
      texture = new Texture(image);
      texture.colorSpace = SRGBColorSpace;
      texture.needsUpdate = true;
      fitCover(texture, viewAspect);
      scene.background = texture;
      onLoad();
    },
    () => {},
  );

  return {
    resize(width, height) {
      viewAspect = width / height;
      if (texture) fitCover(texture, viewAspect);
    },
    dispose() {
      disposed = true;
      if (texture && scene.background === texture) scene.background = null;
      texture?.dispose();
    },
  };
}
