"""면접 방식·면접관 값이 BE enum과 같은지 확인한다(BE InterviewMode·Persona)."""

from app.common.session import InterviewMode, Persona


def test_interview_mode_values_match_backend() -> None:
    assert [m.value for m in InterviewMode] == ["VIDEO", "CHAT"]


def test_persona_values_match_backend() -> None:
    assert [p.value for p in Persona] == ["DEVIL", "COFFEE_CHAT"]


def test_values_parse_from_message_strings() -> None:
    """작업 메시지·배정 정보의 문자열 값을 같은 정의로 해석한다."""
    assert InterviewMode("CHAT") is InterviewMode.CHAT
    assert Persona("COFFEE_CHAT") is Persona.COFFEE_CHAT
