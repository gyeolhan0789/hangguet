"use client";

import { useCallback, useRef } from "react";

// 기준: 웹 · BE Swagger Idempotency-Key("같은 키 · 같은 본문이면 처음 결과를 그대로 반환, 같은 키 · 다른 본문이면 409
// IDEMPOTENCY_KEY_REUSED") · S05-1 방식 선택 폼의 방식별 키 관례
// 응답을 못 받아 같은 본문을 다시 보내면 같은 키를 쓰고, 본문이 바뀌었거나 서버가 실패로 답했으면(spend) 새 키를 쓴다.

/** 보낼 본문에 맞는 멱등 키를 준다 */
export function useRequestKey() {
  const last = useRef<{ body: string; key: string } | null>(null);
  const keyFor = useCallback((body: unknown) => {
    const text = JSON.stringify(body);
    if (last.current?.body !== text) last.current = { body: text, key: crypto.randomUUID() };
    return last.current.key;
  }, []);
  /** 서버가 실패로 답했다: 다음에는 같은 본문이어도 새 키로 보낸다 */
  const spend = useCallback(() => {
    last.current = null;
  }, []);
  return { keyFor, spend };
}
