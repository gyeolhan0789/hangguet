// @vitest-environment node
// 기준: 사용자 결정(2026-11-04: 받은 양은 압축을 푼 바이트로 센다, 받는 도중 10초 동안 데이터가 없으면 끊는다,
// 받는 전체 시간에는 제한이 없다) · MDN Streams API · AbortController
import { beforeEach, describe, expect, it, vi } from "vitest";

import { download, STALL_MS } from "./download";
import { LoadError, StalledError } from "./retry";

// 예시 데이터: 면접관 모델 주소
const ASSET = "/interview/devil/interviewer.glb";

/** 테스트가 조각을 넣는 응답. 끊으면(abort) 읽던 내용도 실패한다 */
function controlledResponse(signal: AbortSignal) {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
        signal.addEventListener("abort", () => controller.error(signal.reason));
      },
    }),
  );
  return {
    response,
    push: (size: number) => stream.enqueue(new Uint8Array(size).fill(size)),
    end: () => stream.close(),
  };
}

// 경계 mock: 네트워크(fetch). 응답 스트림은 테스트가 조각을 넣는다
function stubStreamingFetch() {
  const holder: { stream?: ReturnType<typeof controlledResponse> } = {};
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    holder.stream = controlledResponse(init!.signal!);
    return holder.stream.response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, stream: () => holder.stream! };
}

/** 응답을 바로 주지 않는 fetch. 끊으면 거부한다 */
function stubPendingFetch() {
  const fetchMock = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe("download · 면접관 자산 받기", () => {
  describe("정상 처리", () => {
    it("받은 조각을 순서대로 이어 붙여 돌려주고 받을 때마다 누적 바이트를 알린다", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new Uint8Array([1, 2]));
                  controller.enqueue(new Uint8Array([3]));
                  controller.enqueue(new Uint8Array([4, 5]));
                  controller.close();
                },
              }),
            ),
        ),
      );
      const received = vi.fn();

      const buffer = await download(ASSET, received);

      expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3, 4, 5]);
      expect(received.mock.calls).toEqual([[2], [3], [5]]);
    });

    it("본문 스트림이 없는 응답은 한 번에 받아 돌려준다", async () => {
      const whole = new Uint8Array([7, 8, 9]).buffer;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: true, status: 200, body: null, arrayBuffer: async () => whole })),
      );

      expect(await download(ASSET)).toBe(whole);
    });
  });

  describe("오류 처리", () => {
    it("성공이 아닌 응답이면 상태 코드를 담은 LoadError로 실패한다", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status: 503 })),
      );

      await expect(download(ASSET)).rejects.toSatisfy(
        (error) => error instanceof LoadError && error.status === 503,
      );
    });

    it("멈춤이 아닌 연결 실패(TypeError)는 그대로 던진다", async () => {
      const error = new TypeError("Failed to fetch");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw error;
        }),
      );

      await expect(download(ASSET)).rejects.toBe(error);
    });
  });

  describe("시간 경과", () => {
    it("조각이 10초보다 짧은 간격으로 계속 오면 전체가 길어도 끊지 않는다", async () => {
      const { stream } = stubStreamingFetch();
      const received = vi.fn();
      const done = download(ASSET, received);
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(9_999);
      stream().push(10);
      await vi.advanceTimersByTimeAsync(9_999);
      stream().push(10);
      await vi.advanceTimersByTimeAsync(9_999);
      stream().push(10);
      stream().end();

      await expect(done).resolves.toHaveProperty("byteLength", 30);
      expect(received.mock.calls).toEqual([[10], [20], [30]]);
    });

    it.each([
      {
        label: "첫 응답 전",
        start: () => ({ fetchMock: stubPendingFetch(), afterStart: () => {} }),
      },
      {
        label: "받는 도중",
        start: () => {
          const { fetchMock, stream } = stubStreamingFetch();
          return { fetchMock, afterStart: () => stream().push(10) };
        },
      },
    ])("'$label'에 10초 동안 데이터가 없으면 끊고 StalledError로 실패한다", async ({ start }) => {
      const { fetchMock, afterStart } = start();
      const done = download(ASSET);
      const failed = expect(done).rejects.toBeInstanceOf(StalledError);
      await vi.advanceTimersByTimeAsync(0);
      afterStart();

      await vi.advanceTimersByTimeAsync(9_999);
      expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await failed;
      expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    });
  });

  describe("정리", () => {
    it("끝난 뒤 10초가 지나도 받기를 끊지 않는다", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2])));
      vi.stubGlobal("fetch", fetchMock);

      await download(ASSET);
      await vi.advanceTimersByTimeAsync(STALL_MS);

      expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
    });
  });
});
