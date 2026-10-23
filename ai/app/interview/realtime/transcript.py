"""Soniox 실시간 응답의 토큰으로 답변 글(content)과 답변 토큰(tokens)을 생성한다.

기준: AI 명세 6.2(확정 토큰을 단어로 합치지 않고 그대로 사용하고 끝 표시 토큰은 제외한다).
tokens 범위는 AI 명세 6.2를 따른다(10,000개 이하, 0 ≤ startMs ≤ endMs).
브라우저용 frontend/src/lib/stt/transcript.ts와 같은 규칙이다.
다만 에이전트가 음성 스트림을 직접 Soniox로 전송하므로,
시각의 기준은 이 답변 스트림의 시작(answerStartedAt, AI 명세 6.2)이다.
Soniox 시각은 연결마다 0부터 다시 시작하므로,
연결을 시작할 때 그 연결로 처음 전송하는 음성이 스트림의 몇 밀리초 지점인지(offset)를 입력받아
토큰마다 더한다.
화면 자막(AI 명세 6.3 interview.stt)은 확정 글과 최신 미확정 글을 함께 표시하므로 둘 다 제공한다.
미확정 글은 다음 응답에서 변경될 수 있어 답변 글과 답변 토큰에는 포함하지 않는다.
"""

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from app.common.answer import SpeechToken

# AI 명세 6.2: 화상 답변 tokens는 10,000개 이하다
MAX_ANSWER_TOKENS = 10_000

# Soniox 표시 토큰.
# 끝 감지(<end>)·수동 확정(<fin>) 신호이므로 글이 아니다
ENDPOINT_TOKEN = "<end>"
FINALIZE_TOKEN = "<fin>"
SPECIAL_TOKENS = frozenset({ENDPOINT_TOKEN, FINALIZE_TOKEN})


@dataclass(frozen=True)
class SonioxToken:
    """Soniox 실시간 응답 tokens의 원소.

    시각은 그 연결의 음성 시작 기준 밀리초이며 없을 수 있다.
    """

    text: str
    start_ms: float | None
    end_ms: float | None
    is_final: bool


def soniox_tokens(response: Mapping[str, Any]) -> tuple[SonioxToken, ...]:
    """Soniox 실시간 응답 JSON 하나의 tokens를 변환한다."""
    return tuple(
        SonioxToken(
            text=token["text"],
            start_ms=token.get("start_ms"),
            end_ms=token.get("end_ms"),
            is_final=token["is_final"],
        )
        for token in response.get("tokens", [])
    )


@dataclass(frozen=True)
class _FinalToken:
    text: str
    start_ms: float | None
    end_ms: float | None
    # 이 토큰을 수신한 연결의 offset이다.
    # 토큰마다 보관해야 재연결 전후의 시각을 각각 보정할 수 있다
    offset_ms: float
    # 이 토큰을 수신한 연결의 순번이다.
    # Soniox 시각은 연결마다 0부터 시작하므로 같은 연결의 시각끼리만 비교한다
    connection: int


def _round_ms(value: float) -> int:
    # 브라우저 코드의 Math.round와 결과를 일치시키기 위해 .5는 올림한다.
    # Python round는 짝수 쪽으로 반올림하므로 사용하지 않는다
    return math.floor(value + 0.5)


class Transcript:
    """답변 하나의 전사 상태.

    확정 토큰은 수신한 순서대로 누적한다.
    """

    def __init__(self) -> None:
        self._finals: list[_FinalToken] = []
        self._interim = ""
        self._has_interim = False
        self._offset_ms = 0.0
        self._connection = 0
        self._speech_end_ms: float | None = None

    @property
    def final_count(self) -> int:
        """지금까지 수신한 확정 토큰 수."""
        return len(self._finals)

    @property
    def has_interim(self) -> bool:
        """마지막 응답에 미확정 토큰이 남아 있는지."""
        return self._has_interim

    @property
    def confirmed_text(self) -> str:
        """확정 글.

        화면 자막에 그대로 표시하도록 앞뒤 공백을 제거하지 않는다.
        """
        return "".join(token.text for token in self._finals)

    @property
    def interim_text(self) -> str:
        """마지막 응답의 미확정 글.

        Soniox는 응답마다 미확정 글 전체를 다시 전송하므로 이전 값을 대체한다.
        """
        return self._interim

    @property
    def speech_end_ms(self) -> float | None:
        """현재 연결에서 수신한 비공백 토큰 end_ms의 최댓값(미확정 포함).

        답변 종료 판단이 발화 여부를 이 값의 증가로 판단하므로 미확정 토큰도 포함한다.
        시각이 연결마다 0부터 다시 시작하므로 연결마다 새로 계산한다.
        """
        return self._speech_end_ms

    def begin_connection(self, offset_ms: float) -> None:
        """새 연결(첫 연결·재연결)을 시작한다.

        확정 토큰은 유지하고, 이전 연결의 미확정 글과 end_ms 최댓값은 폐기한다.
        """
        if offset_ms < 0:
            raise ValueError("offset_ms는 0 이상이어야 한다")
        self._offset_ms = offset_ms
        self._connection += 1
        self._interim = ""
        self._has_interim = False
        self._speech_end_ms = None

    def apply(self, tokens: Iterable[SonioxToken]) -> None:
        """Soniox 응답 하나를 반영한다.

        확정 토큰은 답변에 연결하고, 미확정 토큰은 화면 자막용 글로만 보관한다.
        """
        interim: list[str] = []
        has_interim = False
        for token in tokens:
            if token.text in SPECIAL_TOKENS:
                continue
            if token.is_final:
                self._finals.append(
                    _FinalToken(
                        token.text, token.start_ms, token.end_ms, self._offset_ms, self._connection
                    )
                )
            else:
                interim.append(token.text)
                has_interim = True
            if token.text.strip() and token.end_ms is not None:
                current = self._speech_end_ms
                self._speech_end_ms = (
                    token.end_ms if current is None else max(current, token.end_ms)
                )
        self._interim = "".join(interim)
        self._has_interim = has_interim

    def confirmed_since(self, start: int) -> str:
        """start번째 확정 토큰부터의 확정 글."""
        return "".join(token.text for token in self._finals[start:])

    def last_end_ms_since(self, start: int) -> float | None:
        """start번째 확정 토큰부터 현재 연결에서 수신한 마지막 비공백 토큰의 end_ms(연결 기준).

        시각이 없는 토큰은 건너뛰고, 해당하는 토큰이 없으면 None이다.
        """
        for token in reversed(self._finals[start:]):
            if token.connection != self._connection:
                return None
            if token.text.strip() and token.end_ms is not None:
                return token.end_ms
        return None

    def content(self) -> str:
        """답변 글: 확정 글의 앞뒤 공백을 제거한다."""
        # 토큰은 단어 일부·공백·앞에 공백이 붙은 단어일 수 있으므로 구분자 없이 연결한다
        return self.confirmed_text.strip()

    def answer_tokens(self) -> tuple[SpeechToken, ...] | None:
        """답변 토큰을 생성한다.

        시각은 Soniox 시각에 그 연결의 offset을 더해 반올림한 밀리초다.
        하나라도 tokens 범위(AI 명세 6.2: 시각 있음, 0 이상, endMs ≥ startMs, 빈 text 아님,
        10,000개 이하)를 벗어나면 None을 반환한다.
        tokens는 선택 값이므로 답변 글은 그대로 전달하고, 이 경우 말하기 지표만 비게 된다.
        """
        if len(self._finals) > MAX_ANSWER_TOKENS:
            return None
        result: list[SpeechToken] = []
        for token in self._finals:
            if token.start_ms is None or token.end_ms is None:
                return None
            start_ms = _round_ms(token.start_ms + token.offset_ms)
            end_ms = _round_ms(token.end_ms + token.offset_ms)
            if not token.text or start_ms < 0 or end_ms < start_ms:
                return None
            result.append(SpeechToken(token.text, start_ms, end_ms))
        return tuple(result)
