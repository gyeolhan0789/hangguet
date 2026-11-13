"""면접 방식·면접관 값과 질문 번호 범위.

기준: 목 서버 Mode·Persona(mock/.../interview/InterviewDtos.java), BE InterviewMode·Persona
(backend/.../interview/domain). AI는 DB를 읽지 않고 작업 메시지(AI 명세 1.3)와 에이전트 배정
정보(AI 명세 6.1)의 mode·persona로 값을 받는다. 채점·결과 생성·면접 에이전트가 같은 정의로
해석하도록 한 곳에 둔다.
"""

from enum import StrEnum

# AI 명세 2장: 질문은 seq 1~5로 정확히 5개다
MIN_SEQ = 1
MAX_SEQ = 5
QUESTION_COUNT = MAX_SEQ - MIN_SEQ + 1
# AI 명세 6.1: 면접방 이름은 interview-{sessionId}다
ROOM_NAME_PREFIX = "interview-"

# AI 명세 6.7: 그룹 면접은 한 면접에 공통 질문 2개 · 개인 맞춤 질문 2개 · 꼬리질문 0~2개를 묻는다.
# 질문 번호는 1부터 최대 6이다
GROUP_COMMON_QUESTION_COUNT = 2
GROUP_PERSONAL_QUESTION_COUNT = 2
GROUP_MAX_FOLLOWUPS = 2
GROUP_MAX_SEQ = GROUP_COMMON_QUESTION_COUNT + GROUP_PERSONAL_QUESTION_COUNT + GROUP_MAX_FOLLOWUPS
# AI 명세 6.7: 그룹 면접방 이름은 group-{groupId}, 지원자 참가자 이름은 candidate-{sessionId}다
GROUP_ROOM_NAME_PREFIX = "group-"
GROUP_CANDIDATE_PREFIX = "candidate-"


class InterviewMode(StrEnum):
    """면접 방식. BE InterviewMode와 같다."""

    VIDEO = "VIDEO"
    CHAT = "CHAT"


class Persona(StrEnum):
    """면접관. 목 서버 Persona와 같다."""

    DEVIL = "DEVIL"
    COFFEE_CHAT = "COFFEE_CHAT"
    DUCK = "DUCK"


def room_name(session_id: int) -> str:
    """면접방 이름(AI 명세 6.1)."""
    return f"{ROOM_NAME_PREFIX}{session_id}"


def group_room_name(group_id: int) -> str:
    """그룹 면접방 이름(AI 명세 6.7)."""
    return f"{GROUP_ROOM_NAME_PREFIX}{group_id}"


def group_candidate(session_id: int) -> str:
    """그룹 면접방에서 지원자의 참가자 이름(AI 명세 6.7)."""
    return f"{GROUP_CANDIDATE_PREFIX}{session_id}"
