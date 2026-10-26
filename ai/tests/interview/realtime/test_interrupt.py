import pytest

from app.common.answer import SpeechToken
from app.common.session import Persona
from app.interview.realtime.interrupt import (
    INTERRUPT_PHRASES,
    MAX_SPEAKING_MS,
    Interrupt,
    InterruptReason,
    decide_interrupt,
    off_topic_question,
    speaking_ms,
)

OFF = InterruptReason.OFF_TOPIC
LONG = InterruptReason.TOO_LONG


def decide(
    off_topic: float | None, speaking: int | None, issued: frozenset[InterruptReason] = frozenset()
) -> InterruptReason | None:
    interrupt = decide_interrupt(off_topic, speaking, persona=Persona.DEVIL, issued=issued)
    return None if interrupt is None else interrupt.reason


def test_off_topic_wins_when_both_apply() -> None:
    assert decide(0.9, MAX_SPEAKING_MS) is OFF


def test_each_reason_only_once_per_answer() -> None:
    assert decide(0.9, MAX_SPEAKING_MS, frozenset({OFF})) is LONG
    assert decide(0.9, MAX_SPEAKING_MS, frozenset({OFF, LONG})) is None


def test_too_long_does_not_wait_for_jev() -> None:
    assert decide(None, MAX_SPEAKING_MS) is LONG


@pytest.mark.parametrize(
    ("off_topic", "speaking", "expected"),
    [(0.7, 0, OFF), (0.69, 0, None), (None, 120_000, LONG), (None, 119_999, None)],
)
def test_thresholds_are_inclusive(
    off_topic: float | None, speaking: int, expected: InterruptReason | None
) -> None:
    assert decide(off_topic, speaking) is expected


def test_unknown_speaking_time_is_not_treated_as_zero_or_long() -> None:
    assert decide(None, None) is None
    assert speaking_ms(None) is None


def test_speaking_time_uses_speech_metrics_rule() -> None:
    tokens = (
        SpeechToken("저는", 0, 500),
        SpeechToken(" 먼저", 600, 1_000),
        # 문장 중간의 2초 이상 멈춤은 발화 시간에서 뺀다(AI 명세 3장 speakingMs)
        SpeechToken(" 분석했습니다.", 4_000, 5_000),
    )
    assert speaking_ms(tokens) == 2_000
    assert speaking_ms(()) == 0


def test_every_persona_has_phrase_for_every_reason() -> None:
    for persona in Persona:
        for reason in InterruptReason:
            assert INTERRUPT_PHRASES[(persona, reason)]
    interrupt = decide_interrupt(
        None, MAX_SPEAKING_MS, persona=Persona.COFFEE_CHAT, issued=frozenset()
    )
    assert interrupt == Interrupt(LONG, "좋아요, 그중 가장 중요한 부분만 들려주세요.")
    assert interrupt.to_json() == {"reason": "TOO_LONG", "text": interrupt.text}


def test_off_topic_question_refers_to_answer_and_question() -> None:
    question = off_topic_question()
    assert question["type"] == "noul"
    assert "`answer`" in question["instructions"]
    assert "`question`" in question["instructions"]
