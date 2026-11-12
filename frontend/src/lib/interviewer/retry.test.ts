// @vitest-environment node
// 기준: 사용자 결정(2026-10-22: 시간 제한 없이 실패 상태로 판단, 자동 재시도 최대 5번 · 2026-11-04: 받는 도중 멈추면 다시 받기)
// · Google Cloud 재시도 전략(지수 백오프 + 지터) · 네트워크 오류 · 429 · 5xx만 다시 하고 4xx · 해석 실패는 바로 실패
import { describe, expect, it, vi } from "vitest";

import {
  backoffDelay,
  classifyFailure,
  LoadError,
  StalledError,
  withRetry,
  type RetryEnv,
} from "./retry";

// 경계 대역: 기다리기 · 온라인 여부 · 무작위 값(RetryEnv). 실제로 기다리지 않고 난수를 0으로 고정한다
function fakeEnv(online: () => boolean = () => true) {
  return {
    isOnline: vi.fn(online),
    waitOnline: vi.fn(async () => {}),
    sleep: vi.fn(async () => {}),
    random: vi.fn(() => 0),
  } satisfies RetryEnv;
}

describe("classifyFailure · 실패 종류", () => {
  describe("정상 처리", () => {
    it.each([
      { label: "LoadError", error: new LoadError("모델", 500) },
      { label: "TypeError", error: new TypeError("Failed to fetch") },
      { label: "그 밖의 오류", error: new SyntaxError("Unexpected token") },
    ])("오류가 '$label'여도 오프라인이면 offline이다", ({ error }) => {
      expect(classifyFailure(error, false)).toBe("offline");
    });

    it("받다가 멈춘 받기면 retryable이다", () => {
      expect(classifyFailure(new StalledError("멈춤"), true)).toBe("retryable");
    });

    it("응답 없이 실패한 요청(TypeError)이면 retryable이다", () => {
      expect(classifyFailure(new TypeError("Failed to fetch"), true)).toBe("retryable");
    });
  });

  describe("경계값", () => {
    it.each([
      { status: 428, kind: "fatal" },
      { status: 429, kind: "retryable" },
      { status: 430, kind: "fatal" },
      { status: 499, kind: "fatal" },
      { status: 500, kind: "retryable" },
    ])("상태 '$status'를 $kind로 가른다", ({ status, kind }) => {
      expect(classifyFailure(new LoadError("모델", status), true)).toBe(kind);
    });
  });

  describe("오류 처리", () => {
    it("해석 실패 같은 그 밖의 오류면 fatal이다", () => {
      expect(classifyFailure(new SyntaxError("Unexpected token"), true)).toBe("fatal");
    });
  });
});

describe("backoffDelay · 다시 하기 전 대기", () => {
  describe("정상 처리", () => {
    it.each([
      { retry: 0, ms: 1000 },
      { retry: 1, ms: 2000 },
      { retry: 2, ms: 4000 },
      { retry: 3, ms: 8000 },
      { retry: 4, ms: 16000 },
    ])("'$retry'번째 재시도는 $ms ms를 기다린다", ({ retry, ms }) => {
      expect(backoffDelay(retry, 0)).toBe(ms);
    });
  });

  describe("경계값", () => {
    it("무작위 값이 0이면 더하지 않고 1이면 1초를 더한다", () => {
      expect(backoffDelay(0, 0)).toBe(1000);
      expect(backoffDelay(0, 1)).toBe(2000);
    });
  });
});

describe("withRetry · 실패 상태에 따라 다시 하기", () => {
  describe("정상 처리", () => {
    it("성공하면 결과를 돌려주고 다시 하지 않는다", async () => {
      const env = fakeEnv();
      const task = vi.fn().mockResolvedValue("모델");

      expect(await withRetry(task, env)).toBe("모델");
      expect(task).toHaveBeenCalledTimes(1);
      expect(env.sleep).not.toHaveBeenCalled();
    });

    it("다시 할 만한 실패면 간격을 늘려 기다린 뒤 다시 해 결과를 돌려준다", async () => {
      const env = fakeEnv();
      const task = vi
        .fn()
        .mockRejectedValueOnce(new LoadError("모델", 503))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue("모델");

      expect(await withRetry(task, env)).toBe("모델");
      expect(env.sleep.mock.calls).toEqual([[1000], [2000]]);
    });
  });

  describe("상태 변화", () => {
    it("오프라인이면 다시 연결될 때까지 기다렸다가 다시 하고 횟수를 쓰지 않는다", async () => {
      let online = false;
      const env = fakeEnv(() => online);
      env.waitOnline.mockImplementation(async () => {
        online = true;
      });
      const task = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new LoadError("모델", 503))
        .mockResolvedValue("모델");

      expect(await withRetry(task, env)).toBe("모델");
      expect(env.waitOnline).toHaveBeenCalledTimes(1);
      // 오프라인 실패는 횟수에 넣지 않아 첫 재시도 간격(1초)부터 쓴다
      expect(env.sleep.mock.calls).toEqual([[1000]]);
    });
  });

  describe("경계값", () => {
    it("처음 한 번에 5번을 더 해도 실패하면 마지막 오류로 실패한다", async () => {
      const env = fakeEnv();
      const errors = Array.from({ length: 7 }, (_, index) => new LoadError(`모델 ${index}`, 503));
      let attempt = 0;
      const task = vi.fn(async () => {
        throw errors[attempt++];
      });

      await expect(withRetry(task, env)).rejects.toBe(errors[5]);
      expect(task).toHaveBeenCalledTimes(6);
    });
  });

  describe("오류 처리", () => {
    it("다시 해도 소용없는 실패(404)면 다시 하지 않고 바로 실패한다", async () => {
      const env = fakeEnv();
      const notFound = new LoadError("모델", 404);
      const task = vi.fn().mockRejectedValue(notFound);

      await expect(withRetry(task, env)).rejects.toBe(notFound);
      expect(task).toHaveBeenCalledTimes(1);
      expect(env.sleep).not.toHaveBeenCalled();
    });
  });
});
