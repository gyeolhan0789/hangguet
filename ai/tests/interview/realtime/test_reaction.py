from typing import Any

import pytest

from app.interview.realtime.reaction import (
    EXPRESSION_INTENSITY,
    INTEREST_QUESTION,
    NEUTRAL_ATTITUDE,
    REACTION_NEEDED_QUESTION,
    REACTION_QUESTION,
    REACTION_THRESHOLD,
    TRUST_QUESTION,
    Attitude,
    InvalidJudgmentError,
    Reaction,
    ReactionContext,
    judgment_from,
    reaction_questions,
)


def answers(
    *, needed: object = 0.9, choice: object = "smile", interest: object = 2.0, trust: object = 2.0
) -> dict[str, Any]:
    return {
        REACTION_NEEDED_QUESTION: {"type": "noul", "noul": needed},
        REACTION_QUESTION: {"type": "choice", "choice": choice, "confidence": 0.9},
        INTEREST_QUESTION: {"type": "score", "score": interest, "confidence": 0.8},
        TRUST_QUESTION: {"type": "score", "score": trust, "confidence": 0.8},
    }


def test_state_has_question_text_pause_answer_and_attitude_without_persona() -> None:
    context = ReactionContext(
        question="질문",
        criteria="기준",
        text="마지막 문장이에요.",
        pause_ms=820.0,
        answer="앞 문장입니다. 마지막 문장이에요.",
        attitude=Attitude(0.6, 0.4),
    )
    assert context.state() == {
        "question": "질문",
        "criteria": "기준",
        "text": "마지막 문장이에요.",
        "pauseMs": 820.0,
        "answer": "앞 문장입니다. 마지막 문장이에요.",
        "attitude": {"interest": 0.6, "trust": 0.4},
    }


def test_questions_ask_each_judgment_separately_with_state_paths() -> None:
    questions = reaction_questions()
    assert {name: q["type"] for name, q in questions.items()} == {
        REACTION_NEEDED_QUESTION: "noul",
        REACTION_QUESTION: "choice",
        INTEREST_QUESTION: "score",
        TRUST_QUESTION: "score",
    }
    # 쉰 시간을 판단에 실제로 사용한다(AI 명세 6.4 입력)
    assert "`pauseMs`" in questions[REACTION_NEEDED_QUESTION]["instructions"]
    assert "`text`" in questions[REACTION_QUESTION]["instructions"]


def test_small_nod_is_left_to_the_screen() -> None:
    criteria = reaction_questions()[REACTION_QUESTION]["criteria"]
    assert "small_nod" not in criteria
    assert set(criteria) == {"nod", "tilt", "smile", "smirk", "frown"}


def test_expression_uses_fixed_intensity() -> None:
    judgment = judgment_from(answers(choice="frown"))
    assert judgment.reaction == Reaction("expression", "frown", EXPRESSION_INTENSITY)
    assert judgment.reaction.to_json() == {
        "type": "expression",
        "expression": "frown",
        "gesture": None,
        "intensity": 0.4,
        "durationMs": 1200,
    }


def test_gesture_has_no_intensity() -> None:
    judgment = judgment_from(answers(choice="tilt"))
    assert judgment.reaction is not None
    assert judgment.reaction.to_json() == {
        "type": "gesture",
        "expression": None,
        "gesture": "tilt",
        "intensity": None,
        "durationMs": 1200,
    }


def test_reaction_starts_at_threshold() -> None:
    assert judgment_from(answers(needed=REACTION_THRESHOLD)).reaction is not None
    assert judgment_from(answers(needed=0.49)).reaction is None


def test_no_reaction_still_updates_attitude() -> None:
    judgment = judgment_from(answers(needed=0.1, choice=None, interest=4.0, trust=1.0))
    assert judgment.reaction is None
    assert judgment.attitude == Attitude(interest=1.0, trust=0.25)


@pytest.mark.parametrize(("score", "expected"), [(0, 0.0), (2, 0.5), (3.3, 0.83), (5, 1.0)])
def test_score_becomes_zero_to_one(score: float, expected: float) -> None:
    assert judgment_from(answers(interest=score)).attitude.interest == expected


def test_neutral_attitude_is_half() -> None:
    assert NEUTRAL_ATTITUDE.to_json() == {"interest": 0.5, "trust": 0.5}


@pytest.mark.parametrize(
    "response",
    [
        None,
        [],
        {},
        answers(needed=True),
        answers(needed="0.9"),
        answers(interest=None),
        answers(choice="small_nod"),
        answers(choice="shrug"),
        {**answers(), REACTION_NEEDED_QUESTION: {"type": "choice", "noul": 0.9}},
    ],
)
def test_malformed_answers_are_rejected(response: object) -> None:
    with pytest.raises(InvalidJudgmentError):
        judgment_from(response)
