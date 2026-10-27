"""Jev 질문을 구성하고, Jev 응답을 면접관 리액션과 태도로 변환한다.

기준: AI 명세 6.4 리액션 판단, 6.3 interview.reaction, API 명세 면접방 메시지의 리액션 값.
Jev 호출은 app.agent.jev가 맡고, 이 모듈은 질문과 응답 해석만 담당한다.
- 반응할지(Noul)와 어떤 반응인지(Choice)를 나누어 질문하고 코드에서 결합한다.
  반응 여부는 확률을 기준값(REACTION_THRESHOLD)과 비교해야 하므로 확률을 반환하는 Noul로 질문한다.
- 태도(Score) 단계는 정도가 아니라 면접관이 처한 상황 문장으로 작성한다.
  Jev 문서가 단계를 정도가 아닌 상황으로 쓰라고 권고하기 때문이다.
- 질문 문구는 state 칸을 백틱 경로(예: `text`)로 가리킨다.
  모델은 질문 이름을 보지 못한다.
- 말하다 쉴 때의 가벼운 끄덕임(small_nod)은 화면이 직접 처리하므로(API 명세 리액션 시점)
  선택지에 포함하지 않는다.
- 면접관 종류(persona)는 state에 넣지 않는다(AI 명세 6.4).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from app.common.rounding import round_half_up_float
from app.interview.realtime.interrupt import OFF_TOPIC_QUESTION, off_topic_question

# 질문 문구(_INSTRUCTIONS·선택지·단계)의 버전.
# 문구를 변경하면 버전을 올리고 app.common.versions에 등록한다(CONTRIBUTING 7장)
REACTION_PROMPT_VERSION = "reaction-v1"
# AI 명세 6.3: 순간 표정 유지 시간(밀리초).
# 화면은 이 값보다 긴 리액션을 폐기하므로, 증가시킬 때는 화면의 상한도 함께 변경한다
REACTION_DURATION_MS = 2_400
# AI 명세 6.3: 첫 판단 전의 태도
NEUTRAL_ATTITUDE_VALUE = 0.5
# AI 명세 6.4 기준값(임시 값): 반응할 내용이 있다고 판단한 확률이 이 값 이상이면 리액션을 전송한다
REACTION_THRESHOLD = 0.5
# AI 명세 6.4 기준값(임시 값): 표정 세기
EXPRESSION_INTENSITY = 0.4

REACTION_NEEDED_QUESTION = "reaction_needed"
REACTION_QUESTION = "reaction"
INTEREST_QUESTION = "interest"
TRUST_QUESTION = "trust"

EXPRESSIONS: frozenset[str] = frozenset({"smile", "frown", "smirk"})
GESTURES: frozenset[str] = frozenset({"nod", "tilt"})
# Jev 문서는 jev-1.13이 앞 선택지 쪽으로 기우는 경향이 있다고 밝히므로,
# 가벼운 동작을 앞에, 강한 표정을 뒤에 배치한다.
# 순서를 변경해도 판단이 같은지는 실제 Jev로 확인한다(AI 명세 10장)
REACTION_CRITERIA: Mapping[str, str] = {
    "nod": "지원자가 질문의 핵심을 짚어 동의하며 끄덕인다",
    "tilt": "지원자의 말뜻이 분명하지 않아 고개를 갸웃한다",
    "smile": "지원자가 구체적이고 좋은 내용을 말해 미소를 짓는다",
    "smirk": "지원자의 주장이 과장되거나 의심스러워 비스듬히 웃는다",
    "frown": "지원자의 말이 근거가 부족하거나 질문과 어긋나 얼굴을 찌푸린다",
}
# 단계 번호가 0부터 커질수록 관심·신뢰가 높다
INTEREST_CRITERIA = (
    "답변이 `question`과 관계없거나 내용이 없어 더 들을 이유를 찾지 못한다",
    "`question`과 관련은 있지만 누구나 할 수 있는 일반적인 이야기만 듣고 있다",
    "지원자 자신의 경험을 듣고 있지만 무엇을 했는지가 아직 구체적이지 않다",
    "지원자가 한 일과 판단을 구체적으로 들어 다음 내용이 궁금하다",
    "지원자가 직접 판단한 근거와 결과를 들어 더 깊이 묻고 싶은 내용이 생겼다",
)
TRUST_CRITERIA = (
    "앞뒤가 맞지 않거나 사실로 보기 어려운 주장을 들었다",
    "주장은 들었지만 근거나 과정은 듣지 못했다",
    "근거를 들었지만 막연해 확인할 방법이 떠오르지 않는다",
    "과정과 근거를 구체적으로 들어 대체로 납득이 된다",
    "수치·과정·본인 역할이 서로 맞아떨어져 그대로 믿을 수 있다",
)
_INSTRUCTIONS = {
    REACTION_NEEDED_QUESTION: (
        "면접관이 질문 `question`에 대한 지원자의 말 `text`를 들었고, "
        "지원자는 그 뒤 `pauseMs`밀리초 동안 말을 멈췄다. "
        "이 말에 표정이나 고갯짓으로 반응할 만한 내용이 있는가?"
    ),
    REACTION_QUESTION: (
        "면접관이 질문 `question`에 대한 지원자의 말 `text`를 듣고 보일 반응으로 "
        "가장 알맞은 것을 고른다."
    ),
    INTEREST_QUESTION: (
        "면접관이 질문 `question`과 채점 기준 `criteria`에 비추어 지금까지의 답변 `answer`를 "
        "들었을 때의 상황을 고른다. 직전 태도는 `attitude.interest`(0~1)다."
    ),
    TRUST_QUESTION: (
        "면접관이 질문 `question`과 채점 기준 `criteria`에 비추어 지금까지의 답변 `answer`를 "
        "들었을 때의 상황을 고른다. 직전 태도는 `attitude.trust`(0~1)다."
    ),
}


class InvalidJudgmentError(ValueError):
    """Jev 응답이 요청한 질문의 답 형식과 맞지 않는다."""


@dataclass(frozen=True)
class Attitude:
    interest: float
    trust: float

    def to_json(self) -> dict[str, float]:
        return {"interest": self.interest, "trust": self.trust}


NEUTRAL_ATTITUDE = Attitude(interest=NEUTRAL_ATTITUDE_VALUE, trust=NEUTRAL_ATTITUDE_VALUE)


@dataclass(frozen=True)
class Reaction:
    type: Literal["expression", "gesture"]
    value: str
    # 동작은 세기를 사용하지 않으므로 None이다
    intensity: float | None
    duration_ms: int = REACTION_DURATION_MS

    def to_json(self) -> dict[str, Any]:
        # 해당하지 않는 키도 null로 담는다(AI 명세 6.3)
        return {
            "type": self.type,
            "expression": self.value if self.type == "expression" else None,
            "gesture": self.value if self.type == "gesture" else None,
            "intensity": self.intensity,
            "durationMs": self.duration_ms,
        }


@dataclass(frozen=True)
class Judgment:
    reaction: Reaction | None
    attitude: Attitude
    # 질문 이탈 확률.
    # 질문하지 않았거나 판단하지 못했으면 None이다
    off_topic: float | None = None


@dataclass(frozen=True)
class ReactionContext:
    """판단 하나의 입력(AI 명세 6.4).

    text는 화상이면 끝난 문장, 채팅이면 입력 칸 전체이고, answer는 지금까지의 답변 글이다.
    """

    question: str
    criteria: str
    text: str
    pause_ms: float
    answer: str
    attitude: Attitude

    def state(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "criteria": self.criteria,
            "text": self.text,
            "pauseMs": self.pause_ms,
            "answer": self.answer,
            "attitude": self.attitude.to_json(),
        }


def reaction_questions(*, off_topic: bool = False) -> dict[str, dict[str, Any]]:
    """POST /v1/systemone의 questions 본문이다.

    off_topic이면 발화 중단을 위한 질문 이탈 질문을 함께 묻는다.
    Jev는 한 요청의 질문을 병렬로 평가하므로 질문을 추가해도 응답 시간이 거의 같다.
    """
    questions: dict[str, dict[str, Any]] = {
        REACTION_NEEDED_QUESTION: {
            "type": "noul",
            "instructions": _INSTRUCTIONS[REACTION_NEEDED_QUESTION],
        },
        REACTION_QUESTION: {
            "type": "choice",
            "instructions": _INSTRUCTIONS[REACTION_QUESTION],
            "criteria": dict(REACTION_CRITERIA),
        },
        INTEREST_QUESTION: {
            "type": "score",
            "instructions": _INSTRUCTIONS[INTEREST_QUESTION],
            "criteria": list(INTEREST_CRITERIA),
        },
        TRUST_QUESTION: {
            "type": "score",
            "instructions": _INSTRUCTIONS[TRUST_QUESTION],
            "criteria": list(TRUST_CRITERIA),
        },
    }
    if off_topic:
        questions[OFF_TOPIC_QUESTION] = off_topic_question()
    return questions


def judgment_from(answers: object) -> Judgment:
    """POST /v1/systemone 응답의 answers를 리액션과 태도로 변환한다."""
    if not isinstance(answers, Mapping):
        raise InvalidJudgmentError("answers가 객체가 아니다")
    attitude = Attitude(
        interest=_attitude(answers, INTEREST_QUESTION, len(INTEREST_CRITERIA)),
        trust=_attitude(answers, TRUST_QUESTION, len(TRUST_CRITERIA)),
    )
    off_topic = (
        _number(answers, OFF_TOPIC_QUESTION, "noul") if OFF_TOPIC_QUESTION in answers else None
    )
    if _number(answers, REACTION_NEEDED_QUESTION, "noul") < REACTION_THRESHOLD:
        return Judgment(None, attitude, off_topic)
    choice = _answer(answers, REACTION_QUESTION, "choice").get("choice")
    if choice in EXPRESSIONS:
        return Judgment(Reaction("expression", choice, EXPRESSION_INTENSITY), attitude, off_topic)
    if choice in GESTURES:
        return Judgment(Reaction("gesture", choice, None), attitude, off_topic)
    raise InvalidJudgmentError("요청하지 않은 반응을 선택했다")


def _attitude(answers: Mapping[Any, Any], name: str, levels: int) -> float:
    # Score는 0부터 시작하는 단계의 확률 가중 평균이므로 마지막 단계 번호로 나누어 0~1로 변환한다
    score = _number(answers, name, "score")
    return round_half_up_float(min(max(score / (levels - 1), 0.0), 1.0), 2)


def _number(answers: Mapping[Any, Any], name: str, key: str) -> float:
    value = _answer(answers, name, key).get(key)
    if not isinstance(value, int | float) or isinstance(value, bool):
        raise InvalidJudgmentError(f"{name}의 {key}가 숫자가 아니다")
    return float(value)


def _answer(answers: Mapping[Any, Any], name: str, kind: str) -> Mapping[Any, Any]:
    answer = answers.get(name)
    if not isinstance(answer, Mapping) or answer.get("type") != kind:
        raise InvalidJudgmentError(f"{name}의 답 형식이 {kind}가 아니다")
    return answer
