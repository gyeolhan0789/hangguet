"use client";

import { useEffect, useState } from "react";

// 기준: API 명세 5.8 「직전 답변 저장 확인」(화상 답변은 에이전트 → 결과 큐 → BE 순서로 저장된다. 면접방 메시지 answer.state submitted를
// 받은 뒤 5.2를 2초마다 불러 answeredCount가 그 답변의 seq 이상이 되면 5.8을 부르고, 10초(임시 값)가 지나도 반영되지 않으면 그대로 부른다.
// 5번 답변 뒤 자동 종료와 [끝내기]에 같이 쓴다) · S15P31A301-257

/** 직전 답변이 저장됐는지 기다리는 최대 시간(API 명세 5.8 임시 값) */
export const SAVE_WAIT_MS = 10_000;

/**
 * 직전 답변이 저장됐는지 기다린다. waiting이 켜진 뒤 saved(5.2 answeredCount가 그 답변의 seq 이상)가 되거나
 * SAVE_WAIT_MS가 지나면 true다. 5.2는 면접 화면이 2초마다 다시 부른다(질문을 기다리는 동안 · 답변을 내는 동안 ·
 * [끝내기] 뒤 기다리는 동안(confirmingSave)). 여기서는 부르지 않는다.
 * waiting이 꺼지면 처음부터 다시 센다.
 */
export function useSaveConfirmed(waiting: boolean, saved: boolean) {
  const [timedOut, setTimedOut] = useState(false);
  const [wasWaiting, setWasWaiting] = useState(waiting);
  if (wasWaiting !== waiting) {
    setWasWaiting(waiting);
    setTimedOut(false);
  }
  useEffect(() => {
    if (!waiting || saved) return;
    const timer = setTimeout(() => setTimedOut(true), SAVE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting, saved]);
  return waiting && (saved || timedOut);
}
