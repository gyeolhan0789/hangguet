"""면접 방식·면접관 값과 그룹 면접방 이름·질문 번호가 BE와 같은지 확인한다."""

from app.common.session import (
    GROUP_MAX_SEQ,
    InterviewMode,
    Persona,
    group_candidate,
    group_room_name,
)


def test_interview_mode_values_match_backend() -> None:
    assert [m.value for m in InterviewMode] == ["VIDEO", "CHAT"]


def test_persona_values_match_backend() -> None:
    assert [p.value for p in Persona] == ["DEVIL", "COFFEE_CHAT", "DUCK"]


def test_values_parse_from_message_strings() -> None:
    """작업 메시지·배정 정보의 문자열 값을 같은 정의로 해석한다."""
    assert InterviewMode("CHAT") is InterviewMode.CHAT
    assert Persona("COFFEE_CHAT") is Persona.COFFEE_CHAT


def test_group_names_match_backend() -> None:
    """그룹 면접방 · 지원자 참가자 이름이 BE와 같다(BE InterviewRoom · LiveKitInterviewRoom)."""
    assert group_room_name(12) == "group-12"
    assert group_candidate(55) == "candidate-55"


def test_group_seq_goes_up_to_six() -> None:
    """그룹 면접 질문 번호는 기본 질문 4개와 꼬리질문 2개까지 1~6이다(BE GroupResultService)."""
    assert GROUP_MAX_SEQ == 6
