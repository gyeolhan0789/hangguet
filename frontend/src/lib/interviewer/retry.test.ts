import { describe, expect, it, vi } from "vitest";

import {
  BASE_DELAY_MS,
  LoadError,
  MAX_RETRIES,
  backoffDelay,
  classifyFailure,
  withRetry,
  type RetryEnv,
} from "./retry";

// 기준: 사용자 결정(2026-10-22: 시간 제한 없이 실패 상태로 판단, 자동 재시도 최대 5번, 오프라인이면 다시 연결될 때까지 기다림)
// · Google Cloud 재시도 전략(지수 백오프 + 지터) · 네트워크 오류 · 429 · 5xx만 다시 하고 4xx · 해석 실패는 바로 실패
// 기다리기(sleep) · 온라인 여부 · 무작위 값은 RetryEnv로 바꿔 끼워, 실제 시간이나 확률에 기대지 않는다.

/** 기다리기는 바로 끝내고, 기다린 시간만 적어 둔다 */
function fakeEnv(online: () => boolean = () => true) {
  const slept: number[] = [];
  const env: RetryEnv = {
    isOnline: online,
    waitOnline: vi.fn(async () => {}),
    sleep: async (ms) => {
      slept.push(ms);
    },
    random: () => 0.5,
  };
  return { env, slept };
}

const httpError = (status: number) => Object.assign(new Error("http"), { response: { status } });

describe("classifyFailure", () => {
  it("오프라인이면 오류 종류와 상관없이 offline", () => {
    expect(classifyFailure(new LoadError("x", 404), false)).toBe("offline");
  });

  it.each([429, 500, 503])("상태 %i는 다시 한다", (status) => {
    expect(classifyFailure(new LoadError("x", status), true)).toBe("retryable");
    expect(classifyFailure(httpError(status), true)).toBe("retryable");
  });

  it.each([400, 403, 404])("상태 %i는 다시 해도 같아 바로 실패", (status) => {
    expect(classifyFailure(new LoadError("x", status), true)).toBe("fatal");
    expect(classifyFailure(httpError(status), true)).toBe("fatal");
  });

  it("응답 없이 실패한 요청(TypeError)은 다시 하고, 해석 실패 같은 그 밖의 오류는 바로 실패", () => {
    expect(classifyFailure(new TypeError("Failed to fetch"), true)).toBe("retryable");
    expect(classifyFailure(new SyntaxError("Unexpected token"), true)).toBe("fatal");
  });
});

describe("backoffDelay", () => {
  it("간격을 1 → 2 → 4 → 8 → 16초로 두 배씩 늘리고, 무작위로 최대 1초를 더한다", () => {
    expect([0, 1, 2, 3, 4].map((retry) => backoffDelay(retry, 0))).toEqual([
      1000, 2000, 4000, 8000, 16000,
    ]);
    expect(backoffDelay(0, 0.999)).toBeLessThan(BASE_DELAY_MS * 2);
  });
});

describe("withRetry", () => {
  it("성공하면 결과를 돌려주고 다시 하지 않는다", async () => {
    const { env, slept } = fakeEnv();
    const task = vi.fn(async () => "ok");

    await expect(withRetry(task, env)).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("다시 할 만한 실패는 간격을 늘려 가며 다시 하다가 성공하면 결과를 돌려준다", async () => {
    const { env, slept } = fakeEnv();
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new LoadError("x", 503))
      .mockResolvedValue("ok");

    await expect(withRetry(task, env)).resolves.toBe("ok");
    expect(task).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([backoffDelay(0, 0.5), backoffDelay(1, 0.5)]);
  });

  it(`처음 한 번 + ${MAX_RETRIES}번 다시 해도 안 되면 마지막 오류로 실패한다`, async () => {
    const { env, slept } = fakeEnv();
    const error = new LoadError("x", 500);
    const task = vi.fn(async () => {
      throw error;
    });

    await expect(withRetry(task, env)).rejects.toBe(error);
    expect(task).toHaveBeenCalledTimes(MAX_RETRIES + 1);
    expect(slept).toHaveLength(MAX_RETRIES);
  });

  it("404처럼 다시 해도 같은 실패는 바로 실패한다", async () => {
    const { env, slept } = fakeEnv();
    const error = new LoadError("x", 404);
    const task = vi.fn(async () => {
      throw error;
    });

    await expect(withRetry(task, env)).rejects.toBe(error);
    expect(task).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("오프라인이면 다시 연결될 때까지 기다렸다가 다시 하고, 횟수에 세지 않는다", async () => {
    let online = false;
    const { env, slept } = fakeEnv(() => online);
    vi.mocked(env.waitOnline).mockImplementation(async () => {
      online = true;
    });
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("ok");

    await expect(withRetry(task, env)).resolves.toBe("ok");
    expect(env.waitOnline).toHaveBeenCalledTimes(1);
    expect(slept).toEqual([]);
  });

  it("오프라인으로 끊긴 횟수는 재시도 횟수를 쓰지 않는다", async () => {
    // 오프라인 실패 10번 뒤에도 다시 할 만한 실패를 MAX_RETRIES번 더 다시 한다.
    let offlineLeft = 10;
    const { env, slept } = fakeEnv(() => offlineLeft === 0);
    vi.mocked(env.waitOnline).mockImplementation(async () => {
      offlineLeft--;
    });
    const task = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(withRetry(task, env)).rejects.toBeInstanceOf(TypeError);
    expect(env.waitOnline).toHaveBeenCalledTimes(10);
    expect(slept).toHaveLength(MAX_RETRIES);
    expect(task).toHaveBeenCalledTimes(10 + MAX_RETRIES + 1);
  });
});
