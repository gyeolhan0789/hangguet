"""답변 토큰·음성 지표 형식과 답변 글 공백 판단.

면접 에이전트가 화상 답변을 전사해 답변 완료 메시지로 전송하고(AI 명세 6.2),
분석 작업자가 BE가 저장한 같은 값을 작업 메시지로 수신한다(AI 명세 1.3).
두 실행 진입점이 같은 정의로 해석하도록 공용 모듈에 둔다.
"""

import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

# BE @NotBlank(Hibernate Validator 9)는 Java String.isBlank로 검사한다.
# isBlank는 Character.isWhitespace 기준이라 줄 바꿈 없는 공백(NBSP 등)을 공백으로 보지 않는다
JAVA_NON_BREAKING_SPACES = frozenset("\u00a0\u2007\u202f")
JAVA_CONTROL_WHITESPACE = frozenset("\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f")


@dataclass(frozen=True)
class SpeechToken:
    """STT가 확정한 토큰과 발화 시각(밀리초).

    단어 일부·공백을 포함한 원래 단위다.
    """

    text: str
    start_ms: int
    end_ms: int

    def to_json(self) -> dict[str, str | int]:
        return {"text": self.text, "startMs": self.start_ms, "endMs": self.end_ms}


@dataclass(frozen=True)
class VoiceMetrics:
    """면접 에이전트가 실시간 음성으로 계산한 말끝 흐림·억양 폭(AI 명세 3장, answers.speech).

    구하지 못한 값은 None이다.
    화상 답변 완료 메시지·채점 작업·결과 생성 작업이 같은 키를 사용한다.
    """

    trailing_off_ratio: float | None
    pitch_range_st: float | None

    def to_json(self) -> dict[str, float | None]:
        return {"trailingOffRatio": self.trailing_off_ratio, "pitchRangeSt": self.pitch_range_st}


@dataclass(frozen=True)
class ImpressionSample:
    """답변 중 사진 한 장의 인상 판단(answers.speech.impressions.items, AI 명세 6.6).

    at_ms는 답변 시작 기준 밀리초, face는 실제 얼굴 확률,
    scores는 6항목 점수(0~100, 받지 못하면 None)다.
    """

    at_ms: int
    face: float
    scores: Mapping[str, float | None]


@dataclass(frozen=True)
class TimelineInput:
    """다시보기 타임라인 계산에 쓰는 답변의 값(AI 명세 4장 다시보기 타임라인 입력).

    에이전트가 실시간으로만 구할 수 있어 answers.speech에 저장된 값이다. 구하지 못했으면 None이다.
    """

    trailing_off_at_ms: tuple[int, ...] | None
    impressions: tuple[ImpressionSample, ...] | None


def _is_java_whitespace(char: str) -> bool:
    if char in JAVA_NON_BREAKING_SPACES:
        return False
    return char in JAVA_CONTROL_WHITESPACE or unicodedata.category(char) in ("Zs", "Zl", "Zp")


def is_java_blank(text: str) -> bool:
    """BE @NotBlank(Java String.isBlank)와 같은 기준으로 공백뿐인 글인지 판단한다."""
    return all(_is_java_whitespace(char) for char in text)
