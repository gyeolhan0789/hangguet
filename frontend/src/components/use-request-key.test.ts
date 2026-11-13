// 기준: BE Swagger 10.1 · 10.3 Idempotency-Key(같은 키 · 같은 본문이면 같은 결과, 같은 키 · 다른 본문이면 409 IDEMPOTENCY_KEY_REUSED)
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRequestKey } from "./use-request-key";

let keys = 0;
beforeEach(() => {
  keys = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `key-${++keys}` as ReturnType<typeof crypto.randomUUID>,
  );
});

describe("useRequestKey · 요청 멱등 키", () => {
  describe("중복 · 경쟁 처리", () => {
    it("같은 본문을 다시 보내면 같은 키를 준다", () => {
      const { result } = renderHook(() => useRequestKey());

      const first = result.current.keyFor({ capacity: 3 });

      expect(result.current.keyFor({ capacity: 3 })).toBe(first);
    });

    it("본문이 바뀌면 새 키를 준다", () => {
      const { result } = renderHook(() => useRequestKey());
      result.current.keyFor({ capacity: 3 });

      expect(result.current.keyFor({ capacity: 2 })).toBe("key-2");
    });

    it("서버가 실패로 답해 키를 버리면(spend) 같은 본문이어도 새 키를 준다", () => {
      const { result } = renderHook(() => useRequestKey());
      result.current.keyFor({ capacity: 3 });

      result.current.spend();

      expect(result.current.keyFor({ capacity: 3 })).toBe("key-2");
    });
  });
});
