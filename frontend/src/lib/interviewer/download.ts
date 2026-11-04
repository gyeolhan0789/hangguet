import { LoadError, StalledError } from "./retry";

// 면접관 자산(모델 · 표정 규칙 · 자세 구간 · 배경 그림) 받기. 받은 양을 알리고, 받는 도중 멈추면 끊는다.
// 기준: 사용자 결정(2026-11-04: 진행률은 압축 전 원본 크기로 센다 — gzip 응답은 Content-Length가 없어 three.js가 진행률을 0으로 둔다,
// 받는 도중 10초 동안 데이터가 없으면 멈춘 것으로 보고 다시 받는다. 받는 전체 시간에는 제한을 두지 않는다)
// · MDN Streams API(ReadableStream 읽기) · AbortController

/** 이 시간 동안 받은 데이터가 하나도 없으면 멈춘 것으로 보고 끊는다(첫 응답을 기다릴 때 포함) */
export const STALL_MS = 10_000;

/**
 * url을 받아 내용을 돌려준다. onReceived에는 지금까지 받은 바이트 수(압축을 푼 크기)를 알린다.
 * 응답 코드가 성공이 아니면 LoadError, 데이터가 STALL_MS 동안 오지 않으면 StalledError로 실패한다.
 */
export async function download(
  url: string,
  onReceived?: (bytes: number) => void,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, STALL_MS);
  };

  try {
    watch();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new LoadError(`${url} ${response.status}`, response.status);
    if (!response.body) return await response.arrayBuffer();

    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      watch();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onReceived?.(received);
    }
    return await new Blob(chunks).arrayBuffer();
  } catch (error) {
    if (stalled) throw new StalledError(`${url} ${STALL_MS}ms 동안 받은 데이터 없음`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
