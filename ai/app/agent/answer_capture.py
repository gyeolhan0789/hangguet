"""답변 하나 동안 지원자 음성을 STT로 전달하고, 그 답변의 글·토큰·음성을 모은다.

기준: AI 명세 6.2(질문마다 반복, answerStartedAt은 tokens 시각의 0ms), 3장(말끝 흐림·억양 폭).
- 답변마다 Soniox 연결을 새로 연다.
  Soniox 시각은 연결마다 0부터 시작하므로,
  답변을 시작할 때 연결을 열면 토큰 시각이 answerStartedAt 기준이 된다.
- 전송한 음성은 PCM으로 함께 보관한다.
  말끝 흐림·억양 폭을 그 답변의 음성으로 계산하기 위함이다.
- 비공백 토큰 끝 시각의 최댓값이 증가한 응답을 수신하면 on_speech를 호출한다.
  답변 끝 판단이 이 시점을 발화로 보고 7초를 계산한다(app.interview.realtime.answer_end).
- STT 오류가 발생해도 그때까지 인식된 글은 snapshot으로 제공한다.
  STT 오류 뒤 발화가 있었으면 [답변 완료]로 그 글을 제출하기 때문이다(AI 명세 6.5).
- 끝 감지(<end>)를 수신할 때 문장 끝이면 on_sentence에 문장과 지금까지의 답변 글을 전달한다.
  면접관 리액션은 문장이 끝날 때마다 판단하기 때문이다(AI 명세 6.2 3번).
"""

from __future__ import annotations

from collections.abc import AsyncIterable, AsyncIterator, Callable
from dataclasses import dataclass
from datetime import datetime

from app.agent.stt import SonioxSTT
from app.common.answer import SpeechToken
from app.common.results import KST
from app.interview.realtime.sentence import Sentence, SentenceTracker


def _now() -> datetime:
    return datetime.now(KST)


@dataclass(frozen=True)
class CapturedAnswer:
    """답변 하나의 결과.

    tokens 시각의 0ms가 started_at이다.
    """

    started_at: datetime
    content: str
    # 확정 토큰이 없거나 범위를 벗어나면 None이다(AI 명세 6.2)
    tokens: tuple[SpeechToken, ...] | None
    pcm: bytes


SttFactory = Callable[[Callable[[str, str], None]], SonioxSTT]


class AnswerCapture:
    def __init__(
        self,
        stt_factory: SttFactory,
        *,
        on_speech: Callable[[], None],
        on_update: Callable[[str, str], None] | None = None,
        on_sentence: Callable[[Sentence, str], None] | None = None,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        self._on_speech = on_speech
        self._on_update = on_update
        self._on_sentence = on_sentence
        self._clock = clock
        self._speech_end_ms: float | None = None
        self._pcm = bytearray()
        self._started_at: datetime | None = None
        self._stt = stt_factory(self._updated)
        self._sentences = SentenceTracker(self._stt.transcript)

    async def run(self, audio: AsyncIterable[bytes]) -> CapturedAnswer:
        """음성이 끝날 때까지 STT로 전송한다.

        STT 오류는 호출 측으로 전파한다.
        """
        self._started_at = self._clock()
        await self._stt.run(self._recorded(audio))
        return self.snapshot()

    def snapshot(self) -> CapturedAnswer:
        """지금까지 인식된 결과다.

        답변을 시작하기 전에는 호출할 수 없다.
        """
        if self._started_at is None:
            raise RuntimeError("답변을 시작하기 전이다")
        transcript = self._stt.transcript
        return CapturedAnswer(
            started_at=self._started_at,
            content=transcript.content(),
            tokens=transcript.answer_tokens() or None,
            pcm=bytes(self._pcm),
        )

    async def _recorded(self, audio: AsyncIterable[bytes]) -> AsyncIterator[bytes]:
        async for chunk in audio:
            self._pcm.extend(chunk)
            yield chunk

    def _updated(self, confirmed: str, interim: str) -> None:
        if self._on_update is not None:
            self._on_update(confirmed, interim)
        end = self._stt.transcript.speech_end_ms
        if end is not None and (self._speech_end_ms is None or end > self._speech_end_ms):
            self._speech_end_ms = end
            self._on_speech()
        proc_ms = self._stt.endpoint_proc_ms
        if proc_ms is not None and self._on_sentence is not None:
            sentence = self._sentences.on_endpoint(proc_ms)
            if sentence is not None:
                self._on_sentence(sentence, self._stt.transcript.content())
