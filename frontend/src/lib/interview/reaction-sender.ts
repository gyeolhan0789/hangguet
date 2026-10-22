import type { Sentence } from "@/lib/stt/sentence-end";
import type { ReactionResponse } from "@/types/api";

import type { ReactionActionResult } from "./actions";

// 기준: API 명세 5.11(seq는 답변 안에서 1부터, 응답 순서가 변경되면 가장 큰 seq만 사용한다, 요청 후 ttlMs가 경과한 뒤 도착했거나
// 5.7을 제출한 뒤 도착한 응답은 폐기한다, 서버가 정하지 못하면 reaction null로 200, Nginx 502 · 504면 리액션 없이 진행)
// 화상 답변 하나 동안 문장 끝마다 5.11을 전송하고, 유효한 응답만 전달한다. 리액션을 화면에 표시하지 않는다.

export interface ReactionSender {
  /** 문장 하나를 전송한다. 중지한 뒤에는 전송하지 않는다 */
  send: (sentence: Sentence) => void;
  /** 답변 제출(5.7) · 60초 종료 · 화면 이탈 때 호출한다. 이미 전송한 요청의 응답도 폐기한다 */
  stop: () => void;
}

export interface ReactionSenderOptions {
  /** 5.11 서버 액션. 테스트에서 대체할 수 있도록 주입받는다 */
  request: (seq: number, sentence: Sentence) => Promise<ReactionActionResult>;
  /** 유효한 응답 */
  onReaction: (response: ReactionResponse) => void;
  /** 시각(밀리초). 기본 performance.now */
  now?: () => number;
}

export function createReactionSender({
  request,
  onReaction,
  now = () => performance.now(),
}: ReactionSenderOptions): ReactionSender {
  let nextSeq = 1;
  let latestDelivered = 0;
  let stopped = false;

  function send(sentence: Sentence) {
    if (stopped) return;
    const seq = nextSeq++;
    const sentAt = now();
    void request(seq, sentence).then(
      (result) => {
        // 실패(409 ANSWER_ALREADY_SUBMITTED · 502 · 504 등)는 리액션 없이 진행한다.
        if (stopped || !result.ok || result.seq <= latestDelivered) return;
        const ttlMs = result.reaction?.ttlMs;
        if (ttlMs !== undefined && now() - sentAt > ttlMs) return;
        latestDelivered = result.seq;
        onReaction({
          seq: result.seq,
          reaction: result.reaction,
          attitude: result.attitude,
          interrupt: result.interrupt,
        });
      },
      () => {
        // 서버 액션 호출 자체가 실패해도 리액션 없이 진행한다.
      },
    );
  }

  return {
    send,
    stop: () => {
      stopped = true;
    },
  };
}
