"""면접 에이전트 지표가 실제 사용량만큼 기록되는지 확인한다.

지표는 프로세스 전역 값이라 시험끼리 값이 이어지므로, 시험 전후의 증가량으로 비교한다.
"""

import asyncio
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from prometheus_client import REGISTRY

from app.agent.jev import JEV_TIMEOUT_SECONDS, JevJudge
from app.agent.main import counted_interview, server
from app.agent.metrics import METRICS_DIR, METRICS_PORT
from app.agent.stt import SAMPLE_RATE, SonioxSTT, SttSettings
from app.agent.tts import ElevenLabsTTS, TtsError
from app.common.session import Persona
from tests.agent.test_jev import CONTEXT
from tests.agent.test_jev import http_session as jev_session
from tests.agent.test_stt import FakeWebSocket, mock_session
from tests.agent.test_tts import body as tts_body
from tests.agent.test_tts import http_session as tts_session


def sample(name: str, **labels: str) -> float:
    return REGISTRY.get_sample_value(name, labels) or 0.0


@contextmanager
def increase(name: str, **labels: str) -> Iterator[list[float]]:
    """블록 안에서 증가한 값을 블록이 끝난 뒤 리스트의 첫 값으로 반환한다."""
    before = sample(name, **labels)
    delta: list[float] = []
    yield delta
    delta.append(sample(name, **labels) - before)


def test_server_exposes_metrics_from_interview_processes() -> None:
    """면접은 자식 프로세스에서 진행되므로 multiprocess 모드로 모아야 지표가 보인다."""
    assert server._prometheus_port == METRICS_PORT
    assert server._prometheus_multiproc_dir == METRICS_DIR


def test_active_interviews_counts_only_while_running_even_on_failure() -> None:
    seen: list[float] = []

    async def interview() -> None:
        seen.append(sample("a301_agent_active_interviews"))
        raise RuntimeError("면접 중 오류")

    before = sample("a301_agent_active_interviews")
    counting = counted_interview(interview())
    with pytest.raises(RuntimeError):
        asyncio.run(counting)
    assert seen == [before + 1]
    assert sample("a301_agent_active_interviews") == before


def test_soniox_usage_is_sent_audio_length_in_seconds() -> None:
    async def audio() -> AsyncIterator[bytes]:
        # 16kHz·16비트 단일 채널에서 0.1초는 3,200바이트다
        yield b"\0" * 3200
        yield b"\0" * 6400

    async def run() -> None:
        ws = FakeWebSocket()
        _, context = mock_session(ws)
        with patch("app.agent.stt.aiohttp.ClientSession", return_value=context):
            await asyncio.wait_for(SonioxSTT(SttSettings("secret")).run(audio()), timeout=1)

    assert SAMPLE_RATE == 16000
    with increase("a301_agent_soniox_audio_seconds_total") as delta:
        asyncio.run(run())
    assert delta[0] == pytest.approx(0.3)


def test_elevenlabs_usage_counts_only_synthesized_characters() -> None:
    ok, _ = tts_session(200, tts_body())
    failed, _ = tts_session(500, {})
    with increase("a301_agent_elevenlabs_characters_total") as delta:
        with patch("app.agent.tts.aiohttp.ClientSession", return_value=ok):
            asyncio.run(ElevenLabsTTS("secret").synthesize("질문입니다", Persona.DEVIL))
        synthesizing = ElevenLabsTTS("secret").synthesize("실패한 질문", Persona.DEVIL)
        with (
            patch("app.agent.tts.aiohttp.ClientSession", return_value=failed),
            pytest.raises(TtsError),
        ):
            asyncio.run(synthesizing)
    assert delta[0] == 5


def judge(session: object, timeout_seconds: float = JEV_TIMEOUT_SECONDS) -> None:
    async def run() -> None:
        jev = JevJudge("secret", timeout_seconds=timeout_seconds)
        try:
            await jev.judge(CONTEXT)
        finally:
            await jev.aclose()

    with patch("app.agent.jev.aiohttp.ClientSession", return_value=session):
        asyncio.run(run())


def test_jev_requests_are_counted_by_result() -> None:
    slow = jev_session()

    async def never() -> object:
        await asyncio.Event().wait()
        return {}

    slow.post.return_value.json = never
    name = "a301_agent_jev_requests_total"
    with (
        increase(name, result="ok") as ok,
        increase(name, result="error") as error,
        increase(name, result="timeout") as timeout,
    ):
        judge(jev_session())
        judge(jev_session(status=429))
        judge(slow, timeout_seconds=0.01)
    assert (ok[0], error[0], timeout[0]) == (1, 1, 1)
