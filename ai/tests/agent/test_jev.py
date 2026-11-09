import asyncio
import logging
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from app.agent.jev import JEV_MODEL, JEV_URL, JevJudge
from app.common.versions import REGISTRY, UnregisteredVersionError, VersionKind
from app.interview.realtime.reaction import (
    EXPRESSION_INTENSITY,
    INTEREST_QUESTION,
    REACTION_NEEDED_QUESTION,
    REACTION_PROMPT_VERSION,
    REACTION_QUESTION,
    TRUST_QUESTION,
    Attitude,
    Judgment,
    Reaction,
    ReactionContext,
    reaction_questions,
)

PREVIOUS = Attitude(interest=0.7, trust=0.3)
CONTEXT = ReactionContext(
    question="질문",
    criteria="기준",
    text="문장이에요.",
    pause_ms=500.0,
    answer="문장이에요.",
    attitude=PREVIOUS,
)


def body() -> dict[str, Any]:
    return {
        "model": JEV_MODEL,
        "answers": {
            REACTION_NEEDED_QUESTION: {"type": "noul", "noul": 0.9},
            REACTION_QUESTION: {"type": "choice", "choice": "smile", "confidence": 0.9},
            INTEREST_QUESTION: {"type": "score", "score": 4.0, "confidence": 0.9},
            TRUST_QUESTION: {"type": "score", "score": 2.0, "confidence": 0.9},
        },
        "usage": {"input_tokens": 100, "output_tokens": 10},
    }


def http_session(status: int = 200, payload: object = None) -> MagicMock:
    response = MagicMock(status=status)
    response.json = AsyncMock(return_value=body() if payload is None else payload)
    response.__aenter__ = AsyncMock(return_value=response)
    response.__aexit__ = AsyncMock(return_value=False)
    session = MagicMock()
    session.post = MagicMock(return_value=response)
    session.close = AsyncMock()
    return session


def judge_with(session: MagicMock, **kwargs: Any) -> Judgment:
    async def run() -> Judgment:
        judge = JevJudge("secret", **kwargs)
        try:
            return await judge.judge(CONTEXT)
        finally:
            await judge.aclose()

    with patch("app.agent.jev.aiohttp.ClientSession", return_value=session):
        return asyncio.run(run())


def test_judge_requests_fixed_model_with_state_and_questions() -> None:
    session = http_session()
    judgment = judge_with(session)

    assert judgment == Judgment(
        Reaction("expression", "smile", EXPRESSION_INTENSITY), Attitude(1.0, 0.5)
    )
    session.post.assert_called_once_with(
        JEV_URL,
        headers={"Authorization": "Bearer secret"},
        json={"model": "jev-1.14.0", "state": CONTEXT.state(), "questions": reaction_questions()},
    )


def test_model_and_prompt_are_registered_versions() -> None:
    assert REGISTRY.require(VersionKind.MODEL, JEV_MODEL) == "jev-1.14.0"
    assert REGISTRY.require(VersionKind.PROMPT, REACTION_PROMPT_VERSION) == "reaction-v1"


def test_unregistered_prompt_is_rejected_before_calling_jev() -> None:
    with (
        patch("app.agent.jev.REACTION_PROMPT_VERSION", "reaction-v0"),
        patch("app.agent.jev.aiohttp.ClientSession") as factory,
        pytest.raises(UnregisteredVersionError),
    ):
        JevJudge("secret")
    factory.assert_not_called()


@pytest.mark.parametrize(
    "session",
    [
        http_session(status=429),
        http_session(status=529),
        http_session(payload=[]),
        http_session(payload={"answers": {}}),
    ],
)
def test_failure_keeps_previous_attitude_without_reaction(session: MagicMock) -> None:
    assert judge_with(session) == Judgment(None, PREVIOUS, judged=False)


@pytest.mark.parametrize("error", [aiohttp.ClientConnectionError(), ValueError("json")])
def test_network_and_decode_errors_keep_previous_attitude(error: Exception) -> None:
    session = http_session()
    session.post.return_value.json = AsyncMock(side_effect=error)
    assert judge_with(session) == Judgment(None, PREVIOUS, judged=False)


def test_slow_response_keeps_previous_attitude() -> None:
    session = http_session()

    async def never() -> object:
        await asyncio.Event().wait()
        return body()

    session.post.return_value.json = never
    assert judge_with(session, timeout_seconds=0.01) == Judgment(None, PREVIOUS, judged=False)


def test_connection_is_reused_and_closed() -> None:
    session = http_session()

    async def run() -> None:
        judge = JevJudge("secret")
        await judge.judge(CONTEXT)
        await judge.judge(CONTEXT)
        await judge.aclose()

    with patch("app.agent.jev.aiohttp.ClientSession", return_value=session) as factory:
        asyncio.run(run())

    factory.assert_called_once()
    assert session.post.call_count == 2
    session.close.assert_awaited_once()


def test_video_judge_also_asks_off_topic() -> None:
    session = http_session()
    payload = body()
    payload["answers"]["off_topic"] = {"type": "noul", "noul": 0.75}
    session.post.return_value.json = AsyncMock(return_value=payload)
    judgment = judge_with(session, off_topic=True)
    assert judgment.off_topic == 0.75
    sent = session.post.call_args.kwargs["json"]["questions"]
    assert sent == reaction_questions(off_topic=True)


def timer(*ticks: float) -> Any:
    clock = iter(ticks)
    return lambda: next(clock)


def test_judgment_time_is_logged_in_milliseconds(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.agent.jev"):
        judge_with(http_session(), timer=timer(1.0, 1.312))
    assert [record.getMessage() for record in caplog.records] == ["Jev 판단 완료 ms=312"]


@pytest.mark.parametrize(
    ("session", "message"),
    [
        (http_session(status=429), "Jev 판단 실패: "),
        (http_session(payload={"answers": {}}), "Jev 판단 실패: "),
    ],
)
def test_judgment_failure_keeps_alert_phrase_and_adds_time(
    caplog: pytest.LogCaptureFixture, session: MagicMock, message: str
) -> None:
    with caplog.at_level(logging.INFO, logger="app.agent.jev"):
        judge_with(session, timer=timer(0.0, 0.25))
    [record] = caplog.records
    assert record.getMessage().startswith(message)
    assert record.getMessage().endswith(" ms=250")


def test_judgment_timeout_keeps_alert_phrase_and_adds_time(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Infra 경보가 「Jev 판단 시간 초과」로 건수를 세므로 문구는 그대로 두고 시간만 덧붙인다."""
    session = http_session()

    async def never() -> object:
        await asyncio.Event().wait()
        return body()

    session.post.return_value.json = never
    with caplog.at_level(logging.INFO, logger="app.agent.jev"):
        judge_with(session, timeout_seconds=0.01, timer=timer(0.0, 0.8))
    assert [record.getMessage() for record in caplog.records] == ["Jev 판단 시간 초과 ms=800"]
