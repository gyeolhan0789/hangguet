"""사진 인상 판단의 질문 구성과 응답 해석 시험(AI 명세 6.6)."""

from datetime import datetime, timedelta
from typing import Any

import pytest

from app.common.results import KST
from app.interview.realtime.impression import (
    CAMERA_FIELD,
    FACE_QUESTION,
    FRAME_REF,
    IMPRESSION_CRITERIA,
    IMPRESSION_PROMPT_VERSION,
    MAX_IMPRESSIONS,
    Impression,
    InvalidImpressionError,
    TimedImpression,
    impression_assets,
    impression_from,
    impression_questions,
    impression_state,
    impressions_json,
)

KEYS = ("stability", "confidence", "expression", "emotion", "likeability", "trust")
STARTED = datetime(2026, 10, 30, 14, 0, 0, tzinfo=KST)


def answers(face: object = 0.9, score: object = 2.0) -> dict[str, Any]:
    result: dict[str, Any] = {FACE_QUESTION: {"type": "noul", "noul": face}}
    for key in KEYS:
        result[key] = {"type": "score", "score": score, "confidence": 0.9}
    return result


def test_six_impressions_are_asked_with_five_levels() -> None:
    """역검 소통역량 관찰특성 6가지를 5단계로 묻는다(AI 명세 6.6)."""
    questions = impression_questions()

    assert tuple(IMPRESSION_CRITERIA) == KEYS
    assert questions[FACE_QUESTION]["type"] == "noul"
    for key in KEYS:
        assert questions[key]["type"] == "score"
        assert len(questions[key]["criteria"]) == 5
        assert f"`{CAMERA_FIELD}`" in questions[key]["instructions"]


def test_state_points_camera_to_image_asset() -> None:
    """사진은 assets에 두고 state 칸이 참조 이름으로 가리킨다(Jev 문서 images)."""
    assert impression_state()[CAMERA_FIELD] == FRAME_REF
    assert impression_assets("QUJD") == {
        FRAME_REF: {"type": "image", "format": "jpeg", "data_base64": "QUJD"}
    }


def test_context_excludes_appearance() -> None:
    context = impression_state()["context"]

    assert "외모·성별·나이·피부색·복장·배경은 판단에 쓰지 않고" in context


def test_scores_are_scaled_to_0_100() -> None:
    """5단계 확률 가중 평균(0~4)을 0~100으로 바꾼다."""
    impression = impression_from(answers(score=3.0))

    assert impression.scores == {key: 75.0 for key in KEYS}


def test_scores_are_rounded_to_one_decimal() -> None:
    assert impression_from(answers(score=2.345)).scores["trust"] == 58.6


def test_low_face_probability_keeps_scores() -> None:
    """얼굴 확률이 낮아도 측정값 그대로 남긴다. 기준은 쓰는 쪽에서 적용한다(AI 명세 6.6)."""
    impression = impression_from(answers(face=0.12))

    assert impression.face == 0.12
    assert impression.scores["stability"] == 50.0


def test_missing_score_is_none_and_others_remain() -> None:
    body = answers()
    del body["trust"]
    body["emotion"] = {"type": "score", "score": True}

    scores = impression_from(body).scores

    assert scores["trust"] is None
    assert scores["emotion"] is None
    assert scores["stability"] == 50.0


@pytest.mark.parametrize("face", [None, "0.9", True])
def test_missing_face_probability_is_invalid(face: object) -> None:
    with pytest.raises(InvalidImpressionError):
        impression_from(answers(face=face))


def test_answers_must_be_object() -> None:
    with pytest.raises(InvalidImpressionError):
        impression_from(None)


def timed(ms: int, face: float = 0.9) -> TimedImpression:
    return TimedImpression(
        STARTED + timedelta(milliseconds=ms), Impression(face, {key: 50.0 for key in KEYS})
    )


def test_items_are_relative_to_answer_start_in_order() -> None:
    result = impressions_json((timed(2000), timed(1000)), STARTED, "jev-1.14.0")

    assert result is not None
    assert result["promptVersion"] == IMPRESSION_PROMPT_VERSION
    assert result["modelVersion"] == "jev-1.14.0"
    assert [item["atMs"] for item in result["items"]] == [1000, 2000]
    assert result["items"][0] == {"atMs": 1000, "face": 0.9, **{key: 50.0 for key in KEYS}}


def test_frames_before_answer_start_are_dropped() -> None:
    result = impressions_json((timed(-1), timed(0)), STARTED, "jev-1.14.0")

    assert result is not None
    assert [item["atMs"] for item in result["items"]] == [0]


def test_items_are_capped() -> None:
    frames = tuple(timed(ms) for ms in range(MAX_IMPRESSIONS + 1))

    result = impressions_json(frames, STARTED, "jev-1.14.0")

    assert result is not None
    assert len(result["items"]) == MAX_IMPRESSIONS


BEFORE_START = TimedImpression(STARTED - timedelta(seconds=1), Impression(0.9, {}))


@pytest.mark.parametrize("frames", [(), (BEFORE_START,)])
def test_no_items_is_null(frames: tuple[TimedImpression, ...]) -> None:
    assert impressions_json(frames, STARTED, "jev-1.14.0") is None
