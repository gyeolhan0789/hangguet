"""그룹 면접방 정보(LiveKit room metadata)를 읽는다.

기준: AI 명세 6.7 진행, API 명세 10.11 그룹 면접방 정보, BE GroupDtos.RoomInfo.
- BE만 쓰고 에이전트는 읽기만 한다. 면접방을 만들 때 함께 넣고, 차례 · 단계가 바뀔 때마다 고친다.
  에이전트는 접속할 때 읽은 정보와 변경 이벤트로 받은 정보 중
  turnVersion이 가장 큰 것만 쓴다.
- BE가 같은 정보를 다시 보낼 때(질문 시작 기한 초과)는 turnVersion이 같으므로 버린다.
- 남은 질문이 없으면 phase · turn은 null이다.
- deadlineAt은 BE 시계 기준이다.
  화면과 같이 serverTime과 받은 시각의 차이로 에이전트 시계로 옮긴다.
- 모르는 필드는 무시한다. BE가 필드를 먼저 더해도 진행이 멈추지 않게 하기 위함이다.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from app.common.results import KST

log = logging.getLogger(__name__)


class GroupPhase(StrEnum):
    ASKING = "ASKING"
    SPEAKING = "SPEAKING"
    ANSWERING = "ANSWERING"
    DECIDING = "DECIDING"
    WAITING = "WAITING"


class TurnKind(StrEnum):
    COMMON = "COMMON"
    PERSONAL = "PERSONAL"
    FOLLOWUP = "FOLLOWUP"


class Announce(StrEnum):
    # 질문 전체를 말한다
    FULL = "FULL"
    # 같은 공통 질문의 다음 답변자를 호명만 한다
    CALL = "CALL"


# 그룹 상태 · 참가자 상태 중 에이전트가 처리를 나누는 값
GROUP_ENDED = "ENDED"
PARTICIPANT_DONE = "DONE"
PARTICIPANT_ENDED = "ENDED"


class RoomInfoError(ValueError):
    """방 정보 형식이 틀렸다."""


@dataclass(frozen=True)
class Turn:
    session_id: int
    seq: int
    kind: TurnKind
    # 몇 번째 기본 질문인지(1 공통 · 2 개인 · 3 공통 · 4 개인). 꼬리질문은 None
    base_index: int | None
    announce: Announce
    # 답변 마감(BE 시계). ANSWERING에서만 값이 있다
    deadline_at: datetime | None


@dataclass(frozen=True)
class RoomParticipant:
    session_id: int
    state: str


@dataclass(frozen=True)
class RoomInfo:
    turn_version: int
    server_time: datetime
    group_status: str
    phase: GroupPhase | None
    turn: Turn | None
    participants: tuple[RoomParticipant, ...]

    def participant_state(self, session_id: int) -> str | None:
        return next((p.state for p in self.participants if p.session_id == session_id), None)


def parse_room_info(metadata: str) -> RoomInfo:
    try:
        raw = json.loads(metadata)
    except (json.JSONDecodeError, RecursionError) as e:
        raise RoomInfoError("방 정보가 JSON이 아니다") from e
    if not isinstance(raw, dict):
        raise RoomInfoError("방 정보가 객체가 아니다")
    phase = raw.get("phase")
    turn = raw.get("turn")
    participants = raw.get("participants")
    if not isinstance(participants, list):
        raise RoomInfoError("participants가 목록이 아니다")
    try:
        return RoomInfo(
            turn_version=_int(raw.get("turnVersion"), "turnVersion"),
            server_time=_time(raw.get("serverTime"), "serverTime"),
            group_status=_str(raw.get("groupStatus"), "groupStatus"),
            phase=None if phase is None else GroupPhase(phase),
            turn=None if turn is None else _turn(turn),
            participants=tuple(_participant(p) for p in participants),
        )
    except ValueError as e:
        raise RoomInfoError(f"방 정보 형식이 틀렸다: {e}") from e


def _turn(raw: object) -> Turn:
    if not isinstance(raw, dict):
        raise RoomInfoError("turn이 객체가 아니다")
    base_index = raw.get("baseIndex")
    deadline = raw.get("deadlineAt")
    return Turn(
        session_id=_int(raw.get("sessionId"), "turn.sessionId"),
        seq=_int(raw.get("seq"), "turn.seq"),
        kind=TurnKind(_str(raw.get("kind"), "turn.kind")),
        base_index=None if base_index is None else _int(base_index, "turn.baseIndex"),
        announce=Announce(_str(raw.get("announce"), "turn.announce")),
        deadline_at=None if deadline is None else _time(deadline, "turn.deadlineAt"),
    )


def _participant(raw: object) -> RoomParticipant:
    if not isinstance(raw, Mapping):
        raise RoomInfoError("participants 항목이 객체가 아니다")
    return RoomParticipant(
        session_id=_int(raw.get("sessionId"), "participants.sessionId"),
        state=_str(raw.get("state"), "participants.state"),
    )


def _int(value: Any, name: str) -> int:
    # JSON의 true·false는 파이썬에서 int이므로 bool을 제외한다
    if type(value) is not int:
        raise RoomInfoError(f"{name}가 정수가 아니다")
    return value


def _str(value: Any, name: str) -> str:
    if not isinstance(value, str):
        raise RoomInfoError(f"{name}가 문자열이 아니다")
    return value


def _time(value: Any, name: str) -> datetime:
    parsed = datetime.fromisoformat(_str(value, name))
    if parsed.utcoffset() is None:
        raise RoomInfoError(f"{name}에 시간대가 없다")
    return parsed


def _now() -> datetime:
    return datetime.now(KST)


class RoomInfoTracker:
    """turnVersion이 가장 큰 방 정보와, BE 시계와 에이전트 시계의 차이를 들고 있다."""

    def __init__(self, clock: Callable[[], datetime] = _now) -> None:
        self._clock = clock
        self.latest: RoomInfo | None = None
        # BE 시계 - 에이전트 시계
        self._offset = timedelta(0)

    def update(self, metadata: str) -> RoomInfo | None:
        """받은 방 정보가 가진 것보다 새것이면 반영해 반환한다.

        같거나 낮은 버전이거나 형식이 틀리면 None이다.
        """
        if not metadata:
            return None
        try:
            info = parse_room_info(metadata)
        except RoomInfoError as e:
            log.error("방 정보를 읽지 못해 버린다: %s", e)
            return None
        if self.latest is not None and info.turn_version <= self.latest.turn_version:
            return None
        self.latest = info
        self._offset = info.server_time - self._clock()
        return info

    def local(self, server_time: datetime) -> datetime:
        """BE 시계의 시각을 에이전트 시계로 옮긴다."""
        return server_time - self._offset
