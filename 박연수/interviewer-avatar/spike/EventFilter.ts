import type { InterviewerState, ReactionEvent, ReactionSource } from '@proto/contract';
import { isKnownReactionType } from '@proto/contract';
import { mapReaction, type ReactionAction } from '../reactionMap.ts';

export type FilterReason =
  | 'invalid'
  | 'unknown_type'
  | 'expired'
  | 'stale_sequence'
  | 'not_listening'
  /** utteranceId 가 진행 중인 발화와 다름(이미 끝났거나 취소된 발화) (AvatarBrain) */
  | 'utterance_inactive'
  /** 필터는 통과했지만 제스처 쿨다운으로 반영 안 됨 (AvatarBrain) */
  | 'cooldown';

export type FilterResult =
  { ok: true; action: ReactionAction } | { ok: false; reason: FilterReason };

export class EventFilter {
  /** 출처별 마지막 처리 sequence */
  private lastSeq: Record<ReactionSource, number> = { local: -Infinity, server: -Infinity };

  /**
   * receivedAtMs: 이벤트를 받은 시각(기본 now). 서버 시각은 쓰지 않는다.
   * 받은 시각 + ttlMs 가 지났으면 만료.
   * activeUtteranceId: 진행 중인 발화. 이 발화에 묶인(utteranceId 가 같은) 반응은 speaking 중에도 허용
   */
  check(
    event: ReactionEvent,
    state: InterviewerState,
    nowMs: number,
    receivedAtMs: number = nowMs,
    activeUtteranceId: string | null = null,
  ): FilterResult {
    const raw = event as Partial<ReactionEvent> & { type?: unknown };
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'invalid' };
    if (!isKnownReactionType(raw.type)) return { ok: false, reason: 'unknown_type' };
    if (
      typeof event.sequence !== 'number' ||
      typeof event.ttlMs !== 'number' ||
      (event.source !== 'local' && event.source !== 'server')
    ) {
      return { ok: false, reason: 'invalid' };
    }
    if (!validOptionalFields(event)) return { ok: false, reason: 'invalid' };
    if (nowMs - receivedAtMs >= event.ttlMs) return { ok: false, reason: 'expired' };
    if (event.sequence <= this.lastSeq[event.source])
      return { ok: false, reason: 'stale_sequence' };
    const action = mapReaction(event);
    if (!action) return { ok: false, reason: 'unknown_type' };
    this.lastSeq[event.source] = event.sequence;
    // 답변 완료 후(thinking 등) 도착한 반응은 버린다. state 이벤트는 항상 허용.
    // 진행 중인 발화에 묶인 반응(발화 연계)은 speaking 중에도 허용
    const linkedToSpeech =
      state === 'speaking' && activeUtteranceId !== null && event.utteranceId === activeUtteranceId;
    if (event.type !== 'state' && state !== 'listening' && !linkedToSpeech) {
      return { ok: false, reason: 'not_listening' };
    }
    return { ok: true, action };
  }

  reset(): void {
    this.lastSeq = { local: -Infinity, server: -Infinity };
  }
}

const isNonNegInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 선택 필드(intensity·durationMs·utteranceId·offsetMs)가 있으면 스키마와 같은 범위인지 확인 */
function validOptionalFields(event: ReactionEvent): boolean {
  const e = event as Partial<
    Record<'intensity' | 'durationMs' | 'utteranceId' | 'offsetMs', unknown>
  >;
  if (e.intensity !== undefined) {
    if (typeof e.intensity !== 'number' || !(e.intensity >= 0 && e.intensity <= 1)) return false;
  }
  if (e.durationMs !== undefined && !isNonNegInt(e.durationMs)) return false;
  if (e.utteranceId !== undefined && (typeof e.utteranceId !== 'string' || !e.utteranceId))
    return false;
  if (e.offsetMs !== undefined && (!isNonNegInt(e.offsetMs) || e.utteranceId === undefined))
    return false;
  return true;
}
