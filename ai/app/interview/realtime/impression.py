"""카메라 사진 한 장의 인상 판단 질문을 구성하고, Jev 응답을 인상 점수로 변환한다.

기준: AI 명세 6.6 인상 판단, 6.2 answer.completed speech.impressions.
Jev 호출은 app.agent.impression이 맡고, 이 모듈은 질문과 응답 해석만 담당한다.
- 인상 6가지는 역검 개발자 노트의 소통역량 관찰특성이다.
  단계는 사진 한 장에서 보이는 모습으로 작성한다.
- 실제 사람 얼굴인지(face)도 같은 요청에서 묻는다.
  그림·캐릭터 얼굴에도 인상 점수가 높게 나왔기 때문이다.
- 얼굴 확률이 낮아도 점수를 버리지 않고 측정값 그대로 반환한다.
  얼굴로 볼 기준은 저장한 값을 쓰는 쪽에서 적용한다(AI 명세 6.6).
- 받지 못한 점수는 None이다. 한 항목이 비어도 나머지는 남긴다.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.common.rounding import round_half_up_float

# 질문 문구(CONTEXT·_INSTRUCTIONS·단계)의 버전.
# 문구를 변경하면 버전을 올리고 app.common.versions에 등록한다(CONTRIBUTING 7장)
IMPRESSION_PROMPT_VERSION = "impression-v1"
# state에서 사진을 가리키는 칸과 assets 참조 이름(Jev 문서 images)
CAMERA_FIELD = "camera"
FRAME_REF = "img:frame"
FACE_QUESTION = "real_face"
# AI 명세 6.6: 답변 하나에 담는 판단 수 상한. 1초마다 1장이면 1시간이다
MAX_IMPRESSIONS = 3_600

# 역검 소통역량 관찰특성 6가지. 단계 번호가 0부터 커질수록 인상이 좋다
IMPRESSION_CRITERIA: Mapping[str, tuple[str, tuple[str, ...]]] = {
    "stability": (
        "안정감",
        (
            "긴장이 뚜렷하다(굳은 얼굴, 크게 흔들린 자세, 시선 회피)",
            "긴장한 기색이 보인다",
            "보통이다",
            "대체로 차분해 보인다",
            "매우 차분하고 편안해 보인다",
        ),
    ),
    "confidence": (
        "자신감",
        (
            "위축되어 보인다(고개 숙임, 시선 회피)",
            "다소 자신 없어 보인다",
            "보통이다",
            "자신 있어 보인다",
            "매우 당당해 보인다(바른 자세, 정면 응시)",
        ),
    ),
    "expression": (
        "의사표현",
        (
            "표현이 거의 없다(무표정, 입 다묾)",
            "표현이 적다",
            "보통이다",
            "말하는 모습이 생기 있다",
            "표정과 입 모양으로 적극적으로 말하는 모습이다",
        ),
    ),
    "emotion": (
        "감정 전달",
        (
            "감정이 전혀 드러나지 않는다",
            "감정이 약하게 드러난다",
            "보통이다",
            "감정이 자연스럽게 드러난다",
            "감정이 풍부하고 분명하게 전달된다",
        ),
    ),
    "likeability": (
        "매력도",
        (
            "표정·태도가 차갑거나 불편한 인상을 준다",
            "다소 딱딱한 인상이다",
            "보통이다",
            "표정·태도가 호감을 준다",
            "표정·태도가 매우 호감 있고 밝은 인상이다",
        ),
    ),
    "trust": (
        "신뢰도",
        (
            "믿음이 가지 않는 인상이다(시선 회피, 불안한 태도)",
            "다소 믿음이 덜 간다",
            "보통이다",
            "믿음이 가는 인상이다",
            "매우 믿음직한 인상이다(정면 응시, 안정된 태도)",
        ),
    ),
}
CONTEXT = (
    "화상 면접 중인 지원자를 웹캠으로 찍은 사진이다. "
    "면접관이 이 순간 지원자에게서 받는 인상을 판단한다. "
    "외모·성별·나이·피부색·복장·배경은 판단에 쓰지 않고, 표정·시선·자세·고개 방향만 본다."
)
_FACE_INSTRUCTIONS = (
    f"`{CAMERA_FIELD}`가 웹캠으로 찍은 실제 사람의 얼굴이고, "
    "표정과 시선을 알아볼 수 있을 만큼 보이는가. "
    "그림·캐릭터·사진 속 사진·화면 속 화면, 얼굴이 대부분 가려지거나 화면 밖에 있음, "
    "너무 어둡거나 흐림이면 false"
)


class InvalidImpressionError(ValueError):
    """Jev 응답에서 얼굴 확률을 해석하지 못했다."""


@dataclass(frozen=True)
class Impression:
    """사진 한 장의 판단. 점수는 0~100(소수 첫째 자리), 받지 못한 점수는 None이다."""

    face: float
    scores: Mapping[str, float | None]


@dataclass(frozen=True)
class TimedImpression:
    """찍은 시각이 있는 판단이다. 찍은 시각은 에이전트 시계 기준이다(AI 명세 6.6)."""

    captured_at: datetime
    impression: Impression


def impressions_json(
    frames: Sequence[TimedImpression], answer_started_at: datetime, model: str
) -> dict[str, Any] | None:
    """answer.completed speech.impressions 값이다(AI 명세 6.2·6.6).

    atMs는 answerStartedAt 기준 밀리초다. 답변 시작 전에 찍은 사진은 버리고,
    MAX_IMPRESSIONS개까지만 담는다. 담을 판단이 없으면 None이다.
    """
    items: list[dict[str, Any]] = []
    for frame in sorted(frames, key=lambda f: f.captured_at):
        at_ms = (frame.captured_at - answer_started_at) // timedelta(milliseconds=1)
        if at_ms < 0:
            continue
        items.append({"atMs": at_ms, "face": frame.impression.face, **frame.impression.scores})
        if len(items) == MAX_IMPRESSIONS:
            break
    if not items:
        return None
    return {"promptVersion": IMPRESSION_PROMPT_VERSION, "modelVersion": model, "items": items}


def impression_state(context: str = CONTEXT) -> dict[str, str]:
    return {CAMERA_FIELD: FRAME_REF, "context": context}


def impression_assets(jpeg_base64: str) -> dict[str, dict[str, str]]:
    return {FRAME_REF: {"type": "image", "format": "jpeg", "data_base64": jpeg_base64}}


def impression_questions() -> dict[str, dict[str, Any]]:
    questions: dict[str, dict[str, Any]] = {
        FACE_QUESTION: {"type": "noul", "instructions": _FACE_INSTRUCTIONS},
    }
    for key, (name, criteria) in IMPRESSION_CRITERIA.items():
        questions[key] = {
            "type": "score",
            "instructions": (
                f"`{CAMERA_FIELD}` 사진 속 지원자가 면접관에게 주는 '{name}' 인상의 정도. "
                "`context`를 따른다. 사진에서 판단할 근거가 부족하면 '보통이다'를 고른다"
            ),
            "criteria": list(criteria),
        }
    return questions


def impression_from(answers: object) -> Impression:
    """POST /v1/systemone 응답의 answers를 인상 판단으로 변환한다.

    얼굴 확률이 없으면 판단 전체를 쓸 수 없으므로 실패로 처리한다.
    """
    if not isinstance(answers, Mapping):
        raise InvalidImpressionError("answers가 객체가 아니다")
    face = _number(answers, FACE_QUESTION, "noul")
    if face is None:
        raise InvalidImpressionError(f"{FACE_QUESTION}의 noul이 숫자가 아니다")
    scores = {
        key: _score(answers, key, len(criteria))
        for key, (_, criteria) in IMPRESSION_CRITERIA.items()
    }
    return Impression(face=round_half_up_float(min(max(face, 0.0), 1.0), 2), scores=scores)


def _score(answers: Mapping[Any, Any], name: str, levels: int) -> float | None:
    # Score는 0부터 시작하는 단계의 확률 가중 평균이므로
    # 마지막 단계 번호로 나누어 0~100으로 변환한다
    score = _number(answers, name, "score")
    if score is None:
        return None
    return round_half_up_float(min(max(score / (levels - 1), 0.0), 1.0) * 100, 1)


def _number(answers: Mapping[Any, Any], name: str, key: str) -> float | None:
    answer = answers.get(name)
    if not isinstance(answer, Mapping):
        return None
    value = answer.get(key)
    if not isinstance(value, int | float) or isinstance(value, bool):
        return None
    return float(value)
