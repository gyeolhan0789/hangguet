"""그룹 면접 결과 메시지(AI 명세 6.7 결과 메시지)."""

from datetime import datetime

import pytest

from app.common.answer import SpeechToken
from app.common.results import KST, ResultType
from app.interview.realtime.progress import (
    EndReason,
    ProgressMessageError,
    SpeechResult,
    answer_completed,
    followup_decided,
    group_answer_completed,
    group_question_started,
    question_spoken,
    question_started,
)

STARTED = datetime(2026, 11, 4, 14, 5, 0, 120000, tzinfo=KST)
ENDED = datetime(2026, 11, 4, 14, 6, 30, 450000, tzinfo=KST)


def test_group_question_started_adds_turn_fields_and_allows_sixth_question() -> None:
    message = group_question_started(
        55, 6, STARTED, "꼬리질문", "기준", turn_version=18, kind="FOLLOWUP", speech_ms=4210
    )

    assert message.type is ResultType.QUESTION_STARTED
    assert message.session_id == 55
    assert message.fields == {
        "seq": 6,
        "startedAt": "2026-11-04T14:05:00.120+09:00",
        "content": "꼬리질문",
        "criteria": "기준",
        "promptVersion": None,
        "modelVersion": None,
        "turnVersion": 18,
        "kind": "FOLLOWUP",
        "speechMs": 4210,
    }


def test_individual_messages_still_stop_at_fifth_question() -> None:
    """개인 면접은 질문 5개 그대로다(AI 명세 2장)."""
    with pytest.raises(ProgressMessageError):
        question_started(55, 6, STARTED, "질문", "기준")
    with pytest.raises(ProgressMessageError):
        answer_completed(55, 6, STARTED, "답", None, None, EndReason.AUTO_SUBMIT)


@pytest.mark.parametrize("seq", [0, 7])
def test_group_seq_is_one_to_six(seq: int) -> None:
    with pytest.raises(ProgressMessageError):
        group_question_started(
            55, seq, STARTED, "질문", "기준", turn_version=1, kind="COMMON", speech_ms=0
        )
    with pytest.raises(ProgressMessageError):
        question_spoken(55, seq, turn_version=1, ended_at=ENDED, speech=SpeechResult.ENDED)


def test_negative_speech_length_is_rejected() -> None:
    with pytest.raises(ProgressMessageError):
        group_question_started(
            55, 1, STARTED, "질문", "기준", turn_version=1, kind="COMMON", speech_ms=-1
        )


def test_question_spoken_has_end_time_and_result() -> None:
    message = question_spoken(55, 3, turn_version=17, ended_at=ENDED, speech=SpeechResult.FAILED)

    assert message.type is ResultType.QUESTION_SPOKEN
    assert message.fields == {
        "seq": 3,
        "turnVersion": 17,
        "endedAt": "2026-11-04T14:06:30.450+09:00",
        "speech": "FAILED",
    }


def test_group_answer_completed_adds_turn_version_and_end_time() -> None:
    tokens = (SpeechToken("답", 0, 200),)

    message = group_answer_completed(
        55,
        6,
        STARTED,
        "답변",
        tokens,
        None,
        EndReason.TIME_LIMIT,
        turn_version=20,
        answer_ended_at=ENDED,
    )

    assert message.type is ResultType.ANSWER_COMPLETED
    assert message.fields["seq"] == 6
    assert message.fields["endReason"] == "TIME_LIMIT"
    assert message.fields["turnVersion"] == 20
    assert message.fields["answerEndedAt"] == "2026-11-04T14:06:30.450+09:00"
    assert message.fields["content"] == "답변"


def test_followup_not_needed_has_null_question() -> None:
    message = followup_decided(55, 2, turn_version=18, received_at=ENDED, generation_ms=1830)

    assert message.type is ResultType.FOLLOWUP_DECIDED
    assert message.fields == {
        "seq": 2,
        "turnVersion": 18,
        "needed": False,
        "content": None,
        "criteria": None,
        "promptVersion": None,
        "modelVersion": None,
        "receivedAt": "2026-11-04T14:06:30.450+09:00",
        "generationMs": 1830,
    }


def test_needed_followup_has_question_and_versions() -> None:
    """AI 명세 6.7 followup.decided 예시와 같은 모양이다."""
    message = followup_decided(
        55,
        2,
        turn_version=18,
        received_at=ENDED,
        generation_ms=1830,
        content="그때 팀원 의견을 어떻게 모았나요?",
        criteria="의견 수렴 방법 · 결과",
        prompt_version="group-followup-v1",
        model_version="gpt-5.6-terra",
    )

    assert message.fields["needed"] is True
    assert message.fields["content"] == "그때 팀원 의견을 어떻게 모았나요?"
    assert message.fields["criteria"] == "의견 수렴 방법 · 결과"
    assert message.fields["promptVersion"] == "group-followup-v1"
    assert message.fields["modelVersion"] == "gpt-5.6-terra"


@pytest.mark.parametrize(("content", "criteria"), [(" ", "기준"), ("질문", None), ("질문", " ")])
def test_needed_followup_needs_question_and_criteria(content: str, criteria: str | None) -> None:
    with pytest.raises(ProgressMessageError):
        followup_decided(
            55, 2, turn_version=18, received_at=ENDED, content=content, criteria=criteria
        )
