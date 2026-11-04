// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { download, STALL_MS } from "./download";
import { LoadError, StalledError } from "./retry";

// 기준: 사용자 결정(2026-11-04: 받은 양은 압축을 푼 바이트로 센다, 받는 도중 10초 동안 데이터가 없으면 끊는다,
// 받는 전체 시간에는 제한이 없다)
// 시간은 가짜 타이머로 넘기고, 응답은 테스트가 조각을 직접 넣는 스트림으로 만든다.

const ASSET = "/interview/devil/interviewer.glb";

/** 테스트가 조각을 넣는 응답. 끊으면(abort) 읽던 내용도 실패한다 */
function controlledResponse(signal: AbortSignal) {
  let push!: (size: number) => void;
  let end!: () => void;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        push = (size) => controller.enqueue(new Uint8Array(size).fill(size));
        end = () => controller.close();
        signal.addEventListener("abort", () => controller.error(signal.reason));
      },
    }),
  );
  return { response, push: (size: number) => push(size), end: () => end() };
}

/** 응답을 바로 주지 않는 fetch. 끊으면 거부한다 */
function pendingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
      }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("download (면접관 자산 받기)", () => {
  it("받은 조각을 순서대로 이어 붙여 돌려주고, 받을 때마다 지금까지 받은 바이트 수를 알린다", async () => {
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
    // 다 받으면 멈춤 감시도 끝난다.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("내용이 없는 응답은 빈 내용을 돌려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );

    await expect(download(ASSET)).resolves.toHaveProperty("byteLength", 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("성공이 아닌 응답은 상태 코드를 담은 LoadError로 실패한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    await expect(download(ASSET)).rejects.toSatisfy(
      (error) => error instanceof LoadError && error.status === 503,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("데이터가 STALL_MS보다 짧은 간격으로 계속 오면 전체 시간이 길어도 끊지 않는다", async () => {
    let stream!: ReturnType<typeof controlledResponse>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        stream = controlledResponse(init!.signal!);
        return stream.response;
      }),
    );
    const received = vi.fn();

    const done = download(ASSET, received);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(STALL_MS - 1);
      stream.push(10);
    }
    stream.end();

    await expect(done).resolves.toHaveProperty("byteLength", 50);
    expect(received.mock.calls).toEqual([[10], [20], [30], [40], [50]]);
  });

  it("받는 도중 STALL_MS 동안 데이터가 없으면 끊고 StalledError로 실패한다", async () => {
    let stream!: ReturnType<typeof controlledResponse>;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      stream = controlledResponse(init!.signal!);
      return stream.response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const done = download(ASSET);
    const failed = expect(done).rejects.toBeInstanceOf(StalledError);
    await vi.advanceTimersByTimeAsync(0);
    stream.push(10);
    await vi.advanceTimersByTimeAsync(STALL_MS - 1);
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await failed;
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it("첫 응답이 STALL_MS 동안 오지 않아도 끊고 StalledError로 실패한다", async () => {
    const fetchMock = pendingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const done = download(ASSET);
    const failed = expect(done).rejects.toBeInstanceOf(StalledError);

    await vi.advanceTimersByTimeAsync(STALL_MS);

    await failed;
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
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
    expect(vi.getTimerCount()).toBe(0);
  });
});
