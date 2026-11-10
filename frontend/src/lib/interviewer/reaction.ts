import type { ReactionSnapshot } from "@/lib/interview/room-messages";
import type { Emotion } from "./face-rules";

/** 작은 고개 움직임을 위한 최대 회전량이며 단위는 라디안이다. */
const MAX_NOD = Math.PI / 60;
const MAX_TILT = Math.PI / 60;
const ATTITUDE_PITCH = Math.PI / 180;
const ATTITUDE_EXPRESSION = 0.15;

/** 자막 변경이 멈춘 뒤 자동 끄덕임까지의 화면 표현용 초기 대기 시간이다. */
export const LISTENING_PAUSE_MS = 1000;
export const LISTENING_NOD_DURATION_MS = 1200;

export interface ListeningActivity {
  questionSeq: number;
  streamId: string;
  speechAt: number;
}

export function listeningNodPitch(activity: ListeningActivity | null, now: number): number {
  if (!activity) return 0;
  const elapsed = now - activity.speechAt - LISTENING_PAUSE_MS;
  if (elapsed < 0 || elapsed >= LISTENING_NOD_DURATION_MS) return 0;
  const progress = elapsed / LISTENING_NOD_DURATION_MS;
  return Math.sin(progress * Math.PI * 2) * Math.sin(progress * Math.PI) * (MAX_NOD / 2);
}

/**
 * 오리 면접관이 보여 주는 반응만 남긴다. 기준: API 명세 면접방 메시지(오리 면접관은 자신감 향상이 목적이라 expression은 smile,
 * gesture는 small_nod · nod만 표시하고 frown · smirk · tilt는 표시하지 않는다. attitude도 부정적인 표정으로 반영하지 않는다).
 * 표시하지 않는 반응이면 null, attitude의 신뢰는 중립(0.5) 아래로 내려가지 않게 한다.
 */
export function gentleReaction(snapshot: ReactionSnapshot | null): ReactionSnapshot | null {
  const reaction = snapshot?.message.reaction;
  if (!snapshot || !reaction) return null;
  const shown =
    reaction.type === "expression" ? reaction.expression === "smile" : reaction.gesture !== "tilt";
  if (!shown) return null;
  const { attitude } = snapshot.message;
  return {
    ...snapshot,
    message: {
      ...snapshot.message,
      attitude: { ...attitude, trust: Math.max(attitude.trust, 0.5) },
    },
  };
}

/** 끄덕이는 반응(small_nod · nod)인지. 동작 클립 면접관은 고개를 직접 돌리지 않고 끄덕임 동작을 한 번 한다 */
export function isNodReaction(snapshot: ReactionSnapshot | null): boolean {
  const reaction = snapshot?.message.reaction;
  return reaction?.type === "gesture" && reaction.gesture !== "tilt";
}

export function reactionFrame(snapshot: ReactionSnapshot | null, now: number) {
  const neutral = { emotion: "neutral" as Emotion, emotionWeight: 0, pitch: 0, roll: 0 };
  if (!snapshot?.message.reaction) return neutral;
  const elapsed = now - snapshot.receivedAt;
  const duration = snapshot.message.reaction.durationMs;
  if (elapsed < 0 || elapsed >= duration) return neutral;
  const progress = elapsed / duration;
  const envelope = Math.sin(Math.PI * progress);
  const { reaction, attitude } = snapshot.message;
  let emotion: Emotion;
  let weight: number;
  let pitch = (attitude.interest - 0.5) * 2 * ATTITUDE_PITCH;
  let roll = 0;
  if (reaction.type === "expression") {
    emotion = { smile: "Smile", frown: "Angry", smirk: "Fun" }[reaction.expression] as Emotion;
    weight = reaction.intensity;
    if (reaction.expression === "smirk") roll = MAX_TILT / 2;
  } else {
    const trust = (attitude.trust - 0.5) * 2;
    emotion = trust < 0 ? "Angry" : "Smile";
    weight = Math.abs(trust) * ATTITUDE_EXPRESSION;
    if (reaction.gesture === "tilt") roll = MAX_TILT;
    else
      pitch +=
        Math.sin(progress * Math.PI * 2) * MAX_NOD * (reaction.gesture === "small_nod" ? 0.5 : 1);
  }
  return {
    emotion,
    emotionWeight: weight * envelope,
    pitch: pitch * envelope,
    roll: roll * envelope,
  };
}
