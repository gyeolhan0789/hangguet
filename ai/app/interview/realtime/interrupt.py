"""화상 답변에서 면접관이 발화를 중단시킬지 판단하고, 그때 말할 문구를 정한다.

기준: AI 명세 6.3 interrupt 값, 6.4 리액션 판단.
- 질문 이탈(OFF_TOPIC)은 글의 의미 판단이므로 Jev Noul로 질문한다.
- 지나치게 긴 답변(TOO_LONG)은 수치 비교이므로 Jev에 질문하지 않고 발화 시간으로 코드에서 판단한다.
  발화 시간은 말하기 지표의 speakingMs(AI 명세 3장)와 같은 계산을 사용한다.
- 두 이유에 함께 해당하면 질문 이탈을 우선하고, 같은 답변에서 이유마다 한 번만 판단한다.
- 채팅이면 판단하지 않는다(AI 명세 6.4).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.common.answer import SpeechToken
from app.common.session import Persona
from app.interview.speech import speech_metrics

OFF_TOPIC_QUESTION = "off_topic"
# AI 명세 6.4 기준값(임시 값): 질문 이탈 확률이 이 값 이상이면 OFF_TOPIC이다
INTERRUPT_THRESHOLD = 0.7
# AI 명세 6.4 기준값(임시 값): 발화 시간(밀리초)이 이 값 이상이면 TOO_LONG이다
MAX_SPEAKING_MS = 120_000


class InterruptReason(StrEnum):
    """발화 중단 이유.

    선언 순서가 두 이유가 함께 해당할 때의 우선순위다.
    """

    OFF_TOPIC = "OFF_TOPIC"
    TOO_LONG = "TOO_LONG"


# 면접관이 발화를 중단시키며 말하는 문구(AI 명세 6.4 「이유·면접관별로 설정에 둔 문구」)
INTERRUPT_PHRASES: Mapping[tuple[Persona, InterruptReason], str] = {
    (Persona.DEVIL, InterruptReason.OFF_TOPIC): "질문으로 다시 돌아가 볼게요.",
    (Persona.DEVIL, InterruptReason.TOO_LONG): "핵심만 짧게 말씀해 주세요.",
    (
        Persona.COFFEE_CHAT,
        InterruptReason.OFF_TOPIC,
    ): "흥미로운 이야기네요. 질문으로 다시 돌아가 볼까요?",
    (Persona.COFFEE_CHAT, InterruptReason.TOO_LONG): "좋아요, 그중 가장 중요한 부분만 들려주세요.",
    # 오리 면접관은 면접 자신감 향상이 목적이므로 답변을 격려하는 문구로 중단한다
    (Persona.DUCK, InterruptReason.OFF_TOPIC): "좋은 이야기예요. 질문으로 함께 돌아가 볼까요?",
    (Persona.DUCK, InterruptReason.TOO_LONG): "잘하고 있어요. 가장 중요한 부분부터 들려주세요.",
}


@dataclass(frozen=True)
class Interrupt:
    reason: InterruptReason
    text: str

    def to_json(self) -> dict[str, Any]:
        return {"reason": self.reason.value, "text": self.text}


def off_topic_question() -> dict[str, Any]:
    """POST /v1/systemone의 questions에 추가할 질문 이탈 질문이다."""
    return {
        "type": "noul",
        "instructions": (
            "지원자가 지금까지 말한 답변 `answer`가 면접 질문 `question`과 관계없는 이야기로 "
            "벗어났는가?"
        ),
    }


def speaking_ms(tokens: Sequence[SpeechToken] | None) -> int | None:
    """지금까지 확정된 토큰의 발화 시간(밀리초)이다.

    토큰 시각이 없어 답변 토큰을 만들지 못했으면 None이다.
    발화 시간을 알 수 없을 때 0초로 보면 긴 답변을 놓치는 것과 구분할 수 없기 때문이다.
    """
    if tokens is None:
        return None
    metrics = speech_metrics([token.to_json() for token in tokens])
    return 0 if metrics is None else metrics["speakingMs"]


def decide_interrupt(
    off_topic: float | None,
    speaking: int | None,
    *,
    persona: Persona,
    issued: frozenset[InterruptReason],
) -> Interrupt | None:
    """발화를 중단시킬 이유가 있으면 이유와 면접관 문구를 반환한다.

    off_topic은 Jev 질문 이탈 확률이며, 판단이 아직 없거나 실패했으면 None이다.
    issued의 이유는 같은 답변에서 이미 전송했으므로 제외한다.
    """
    applies = {
        InterruptReason.OFF_TOPIC: off_topic is not None and off_topic >= INTERRUPT_THRESHOLD,
        InterruptReason.TOO_LONG: speaking is not None and speaking >= MAX_SPEAKING_MS,
    }
    for reason in InterruptReason:
        if applies[reason] and reason not in issued:
            return Interrupt(reason, INTERRUPT_PHRASES[(persona, reason)])
    return None
