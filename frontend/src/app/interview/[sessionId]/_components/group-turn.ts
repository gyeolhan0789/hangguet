"use client";

import { useEffect, useState } from "react";

import type { RoomInfoSnapshot } from "@/lib/interview/room-messages";
import type { ParticipantResponse } from "@/types/api";

// 기준: API 명세 10.11 그룹 면접방 정보(turn · phase · participants · serverTime으로 deadlineAt 보정) · BE Swagger RoomInfo · TurnInfo
// · API 명세 10.10('질문 n / 5' 대신 기본 질문 4개 기준) · 그룹 설계 2장(기본 질문 4개 · 30초 이하 1분 연장 1회 · 종료 10초 전 카운트다운)
// 단계 문구는 설계에 없어 사용자 결정(2026-11-13, 빈칸 기본안)을 따른다.

/** 기본 질문 수(그룹 설계 2장: 개인당 4개 = 공통 2 + 개인 맞춤 2). '질문 2 / 4'의 4 */
export const GROUP_BASE_QUESTIONS = 4;

/** 화상 답변 시간 연장(10.8)을 누를 수 있는 남은 시간(초). BE: 남은 시간 30초 이하 · 한 번 */
export const EXTEND_WITHIN_SECONDS = 30;

/** 마감 카운트다운을 보이는 남은 시간(초). 그룹 설계 2장 · 6.6 '종료 10초 전 카운트다운' */
export const COUNTDOWN_SECONDS = 10;

/**
 * 남은 답변 시간(초)을 1초마다 다시 센다. 마감이 없으면(답변 중이 아님) null. BE 시각과 내 시계의 차이로 보정한다.
 * 새 마감이 오면 그 마감으로 시각을 잰 뒤에야 보인다(지난 마감 때 잰 시각으로 첫 1초를 잘못 세지 않게).
 */
export function useRemainingSeconds(deadlineAt: string | null, offsetMs: number): number | null {
  const [clock, setClock] = useState<{ deadlineAt: string | null; now: number }>({
    deadlineAt: null,
    now: 0,
  });
  useEffect(() => {
    if (!deadlineAt) return;
    const tick = () => setClock({ deadlineAt, now: Date.now() });
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [deadlineAt]);
  if (!deadlineAt || clock.deadlineAt !== deadlineAt) return null;
  const now = clock.now;
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - (now + offsetMs)) / 1000));
}

/** 지금 차례 요약: 내 차례인지 · 단계 문구 */
export function describeTurn(
  room: RoomInfoSnapshot | null,
  mySessionId: number,
  members: readonly ParticipantResponse[],
) {
  const info = room?.info ?? null;
  const turn = info?.turn ?? null;
  const myTurn = turn?.sessionId === mySessionId;
  const nameOf = (sessionId: number | undefined) =>
    members.find((member) => member.sessionId === sessionId)?.nickname;
  // 재접속을 기다리는 사람은 가장 먼저 돌아와야 하는 사람(그룹 설계 6.3: WAITING 기한은 가장 이른 absent_until)
  const absent = info?.participants
    .filter((participant) => participant.state === "ABSENT" && participant.absentUntil)
    .sort((a, b) => Date.parse(a.absentUntil!) - Date.parse(b.absentUntil!))[0];
  // 이름을 모르면(10.4를 받지 못함) 문구를 두지 않는다(설계에 없는 대체 이름을 만들지 않는다)
  const answerer = nameOf(turn?.sessionId);
  const waitingFor = nameOf(absent?.sessionId);
  let label: string | null = null;
  switch (info?.phase) {
    case "ASKING":
      label = "면접관이 질문을 준비하고 있어요";
      break;
    case "SPEAKING":
      label = "면접관이 질문하고 있어요";
      break;
    case "ANSWERING":
      if (myTurn) label = "내 차례예요";
      else if (answerer) label = `${answerer} 님이 답하고 있어요`;
      break;
    case "DECIDING":
      label = "면접관이 생각하고 있어요";
      break;
    case "WAITING":
      if (waitingFor) label = `${waitingFor} 님을 기다리고 있어요`;
      break;
  }
  return { info, turn, myTurn, label };
}

/** 남은 초를 '1:05'처럼 쓴다 */
export function formatRemaining(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
