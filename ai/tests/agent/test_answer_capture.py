import asyncio
import json
from collections.abc import AsyncIterable, AsyncIterator, Callable, Sequence
from datetime import datetime
from typing import Any

import pytest

from app.agent.answer_capture import MAX_PCM_BYTES, AnswerCapture
from app.agent.stt import SonioxSTT, SttError, SttSettings, SttState
from app.common.answer import SttGap
from app.common.results import KST
from tests.interview.realtime.replay import FIRST_SENTENCE, FIXTURE, SECOND_SENTENCE

STARTED_AT = datetime(2026, 10, 26, 14, 2, 18, 250_000, tzinfo=KST)
RESPONSES: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))


class ReplaySTT(SonioxSTT):
    """음성 조각 하나를 수신할 때마다 기록한 Soniox 응답 하나를 반영한다."""

    def __init__(
        self,
        on_update: Callable[[str, str], None],
        responses: Sequence[dict[str, Any]],
        *,
        fail_after: int | None = None,
    ) -> None:
        super().__init__(SttSettings("test-key"), on_update=on_update)
        self.responses = list(responses)
        self.fail_after = fail_after

    async def run(self, audio: AsyncIterable[bytes]) -> None:
        index = 0
        async for _chunk in audio:
            if index == self.fail_after:
                raise SttError("Soniox STT 오류 (code=503)")
            if index < len(self.responses):
                self.accept_response(self.responses[index])
            index += 1


async def chunks(count: int) -> AsyncIterator[bytes]:
    for i in range(count):
        yield bytes([i % 256, 0]) * 160
        await asyncio.sleep(0)


def capture(
    responses: Sequence[dict[str, Any]] = RESPONSES,
    *,
    fail_after: int | None = None,
) -> tuple[AnswerCapture, list[int], list[tuple[str, str]]]:
    speeches: list[int] = []
    updates: list[tuple[str, str]] = []
    made = AnswerCapture(
        lambda on_update, _on_state: ReplaySTT(on_update, responses, fail_after=fail_after),
        on_speech=lambda: speeches.append(len(updates)),
        on_update=lambda confirmed, interim: updates.append((confirmed, interim)),
        clock=lambda: STARTED_AT,
    )
    return made, speeches, updates


def test_collects_answer_text_tokens_and_audio() -> None:
    made, _, _ = capture()
    result = asyncio.run(made.run(chunks(len(RESPONSES))))
    assert result.started_at == STARTED_AT
    assert result.content == f"{FIRST_SENTENCE} {SECOND_SENTENCE}"
    assert result.tokens is not None
    # 연결을 답변 시작에 열었으므로 토큰 시각이 answerStartedAt 기준 0부터다
    assert 0 <= result.tokens[0].start_ms < 1_000
    assert all(t.start_ms <= t.end_ms for t in result.tokens)
    assert result.pcm == b"".join(bytes([i % 256, 0]) * 160 for i in range(len(RESPONSES)))


def test_notifies_speech_only_when_speech_end_increases() -> None:
    made, speeches, updates = capture()
    asyncio.run(made.run(chunks(len(RESPONSES))))
    stt = SonioxSTT(SttSettings("test-key"))
    increases = []
    previous = None
    for index, response in enumerate(RESPONSES, 1):
        stt.accept_response(response)
        end = stt.transcript.speech_end_ms
        if end is not None and (previous is None or end > previous):
            increases.append(index)
            previous = end
    assert speeches == increases
    assert len(updates) == len(RESPONSES)


def test_no_speech_has_no_tokens() -> None:
    silent = [{"tokens": [], "total_audio_proc_ms": 100 * i} for i in range(5)]
    made, speeches, _ = capture(silent)
    result = asyncio.run(made.run(chunks(5)))
    assert speeches == []
    assert (result.content, result.tokens) == ("", None)


def test_stt_error_keeps_recognized_text_in_snapshot() -> None:
    """STT 오류 뒤 [답변 완료]로 인식된 글을 제출할 수 있도록 결과를 남긴다(AI 명세 6.5)."""
    made, speeches, _ = capture(fail_after=30)
    with pytest.raises(SttError):
        asyncio.run(made.run(chunks(len(RESPONSES))))
    result = made.snapshot()
    assert speeches
    assert result.content
    assert result.content in f"{FIRST_SENTENCE} {SECOND_SENTENCE}"


def test_snapshot_before_start_is_rejected() -> None:
    made, _, _ = capture()
    with pytest.raises(RuntimeError):
        made.snapshot()


def test_started_at_is_taken_when_listening_begins() -> None:
    """answerStartedAt은 음성 전송을 시작한 시각이다(답변을 마친 시각이 아님)."""
    times = iter([STARTED_AT, datetime(2026, 10, 26, 14, 3, 0, tzinfo=KST)])
    made = AnswerCapture(
        lambda on_update, _on_state: ReplaySTT(on_update, RESPONSES),
        on_speech=lambda: None,
        clock=lambda: next(times),
    )
    result = asyncio.run(made.run(chunks(3)))
    assert result.started_at == STARTED_AT
    assert made.snapshot().started_at == STARTED_AT


def test_sentences_are_reported_with_answer_so_far() -> None:
    """실제 Soniox 응답에서 두 문장이 각각 끝 감지와 함께 문장 끝으로 판단된다."""
    sentences: list[tuple[str, float, str]] = []
    made = AnswerCapture(
        lambda on_update, _on_state: ReplaySTT(on_update, RESPONSES),
        on_speech=lambda: None,
        on_sentence=lambda sentence, answer: sentences.append(
            (sentence.text, sentence.pause_ms, answer)
        ),
        clock=lambda: STARTED_AT,
    )
    asyncio.run(made.run(chunks(len(RESPONSES))))
    assert [(text, answer) for text, _, answer in sentences] == [
        (FIRST_SENTENCE, FIRST_SENTENCE),
        (SECOND_SENTENCE, f"{FIRST_SENTENCE} {SECOND_SENTENCE}"),
    ]
    assert all(pause >= 0 for _, pause, _ in sentences)


class ReconnectingSTT(SonioxSTT):
    """첫 연결에서 900ms까지 말한 뒤 끊기고, 2초 지점부터 새 연결로 이어 듣는 STT 대역.

    새 연결의 Soniox 시각은 0부터 다시 시작한다.
    """

    def __init__(
        self, on_update: Callable[[str, str], None], on_state: Callable[[SttState], None]
    ) -> None:
        super().__init__(SttSettings("test-key"), on_update=on_update, on_state=on_state)

    async def run(self, audio: AsyncIterable[bytes]) -> None:
        async for _chunk in audio:
            pass
        token = {"is_final": True, "start_ms": 0}
        self.accept_response({"tokens": [{**token, "text": "앞", "end_ms": 900}]})
        self._outage_start_ms = 900
        self._notify(SttState.RECONNECTING)
        self.transcript.begin_connection(2000)
        self._reconnected(2000)
        self.accept_response({"tokens": [{**token, "text": " 뒤", "end_ms": 300}]})


def test_speech_after_reconnect_is_detected_and_gap_is_reported() -> None:
    """새 연결의 토큰 끝 시각(300ms)이 이전 연결(900ms)보다 작아도 발화로 감지한다."""
    speeches: list[int] = []
    states: list[SttState] = []
    made = AnswerCapture(
        lambda on_update, on_state: ReconnectingSTT(on_update, on_state),
        on_speech=lambda: speeches.append(len(speeches)),
        on_stt_state=states.append,
        clock=lambda: STARTED_AT,
    )

    answer = asyncio.run(made.run(chunks(1)))

    assert len(speeches) == 2
    assert states == [SttState.RECONNECTING, SttState.RECONNECTED]
    assert answer.stt_gaps == (SttGap(900, 2000),)
    assert answer.content == "앞 뒤"


class CountingSTT(ReplaySTT):
    """받은 음성 조각 수만 센다."""

    def __init__(self, on_update: Callable[[str, str], None]) -> None:
        super().__init__(on_update, [])
        self.sent = 0

    async def run(self, audio: AsyncIterable[bytes]) -> None:
        async for _chunk in audio:
            self.sent += 1


def test_audio_kept_for_metrics_stops_at_limit() -> None:
    """발화 전 대기가 길어져도 답변 음성은 상한까지만 보관하고, STT로는 계속 보낸다."""
    chunk = bytes([1, 0]) * 1_600
    count = MAX_PCM_BYTES // len(chunk) + 3
    stt: list[CountingSTT] = []

    def make(on_update: Callable[[str, str], None], _on_state: object) -> CountingSTT:
        stt.append(CountingSTT(on_update))
        return stt[0]

    async def audio() -> AsyncIterator[bytes]:
        for _ in range(count):
            yield chunk

    made = AnswerCapture(make, on_speech=lambda: None, clock=lambda: STARTED_AT)
    result = asyncio.run(made.run(audio()))
    assert len(result.pcm) == MAX_PCM_BYTES
    assert stt[0].sent == count
