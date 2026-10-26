"""Soniox 끝 감지(<end>)와 확정 글로 문장 끝을 판단한다.

기준: API 명세 면접방 메시지의 문장 끝.
끝 감지가 도착했을 때 확정된 글이 종결어미로 끝나면 문장 끝이고,
쉼표로 끝나거나 미확정 토큰이 남아 있으면 다음 끝 감지까지 연결한다.
pauseMs = 끝 감지 응답의 total_audio_proc_ms - 문장 마지막 확정 토큰 end_ms, 음수면 0.
브라우저 구현에서 옮긴 문장 끝 판단 규칙을 사용한다.
종결어미 판단은 말하기 지표의 문장 경계와 같은 규칙이므로,
app.interview.speech.ends_sentence를 사용한다.
확정 토큰은 transcript.Transcript가 고르고, 이 모듈은 그 결과로 문장 끝만 판단한다.
같은 응답을 두 곳에서 따로 해석하면 한쪽만 변경됐을 때 답변 글과 문장이 어긋나기 때문이다.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from app.interview.realtime.transcript import ENDPOINT_TOKEN, SonioxToken, Transcript
from app.interview.speech import ends_sentence

# 리액션 판단에 전달하는 문장의 최대 글자 수.
# 채팅 입력 상한(AI 명세 6.3 chatInput, 1,000자)과 같게 두어 화상·채팅의 Jev 입력 길이를 일치시킨다.
# Jev 입력 길이를 정한 뒤 조정한다
MAX_SENTENCE_LENGTH = 1_000


@dataclass(frozen=True)
class Sentence:
    text: str
    pause_ms: float


def has_endpoint(tokens: Iterable[SonioxToken]) -> bool:
    """Soniox 응답에 끝 감지 토큰이 포함됐는지 확인한다."""
    return any(token.text == ENDPOINT_TOKEN for token in tokens)


class SentenceTracker:
    """답변 하나에서 아직 문장 끝을 만나지 않은 확정 글의 시작 위치를 보관한다.

    호출 측이 Soniox 응답을 transcript에 반영한 뒤, 끝 감지가 있으면 on_endpoint를 호출한다.
    """

    def __init__(self, transcript: Transcript) -> None:
        self._transcript = transcript
        # 아직 문장으로 전달하지 않은 첫 확정 토큰의 순번
        self._start = 0

    @property
    def text(self) -> str:
        """아직 문장 끝을 만나지 않은 확정 글."""
        return self._transcript.confirmed_since(self._start)

    def on_endpoint(self, total_audio_proc_ms: float) -> Sentence | None:
        """끝 감지를 수신했을 때 호출한다.

        문장 끝이면 문장을 반환하고 다음 문장의 시작 위치로 이동한다.
        미확정 토큰이 남았거나 종결어미로 끝나지 않으면 문장 끝이 아니며,
        글은 다음 끝 감지까지 유지한다.
        재연결 뒤에는 앞 연결의 시각과 비교할 수 없으므로 pauseMs는 0이다.
        """
        transcript = self._transcript
        text = self.text
        if transcript.has_interim or not ends_sentence(text):
            return None
        last_end_ms = transcript.last_end_ms_since(self._start)
        self._start = transcript.final_count
        pause_ms = 0.0 if last_end_ms is None else max(0.0, total_audio_proc_ms - last_end_ms)
        # 리액션은 끝맺은 문장을 대상으로 하므로 길면 문장 끝 쪽을 남긴다
        return Sentence(text=text.strip()[-MAX_SENTENCE_LENGTH:].strip(), pause_ms=pause_ms)
