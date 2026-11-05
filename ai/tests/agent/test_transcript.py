import asyncio
import json
from unittest.mock import AsyncMock, Mock, patch

from app.agent.transcript import TranscriptPublisher


def test_snapshots_target_candidate_with_stable_stream_and_increasing_revision() -> None:
    async def run() -> None:
        participant = Mock(send_text=AsyncMock())
        publisher = TranscriptPublisher(participant, "candidate")
        await publisher.aclose()
        first = json.loads(participant.send_text.await_args.args[0])
        assert first["state"] == "listening"
        assert first["confirmedText"] == first["interimText"] == ""

        publisher = TranscriptPublisher(participant, "candidate")
        publisher.update("확정", " 중간")
        # 첫 전송이 시작된 뒤 새 전체 결과로 교체한다.
        while participant.send_text.await_count < 2:
            await asyncio.sleep(0)
        publisher.update("확정 수정", "")
        publisher.fail()
        await publisher.aclose()
        calls = participant.send_text.await_args_list[1:]
        payloads = [json.loads(call.args[0]) for call in calls]
        assert len({payload["streamId"] for payload in payloads}) == 1
        assert payloads[-1]["revision"] > payloads[0]["revision"]
        assert payloads[-1]["confirmedText"] == "확정 수정"
        assert payloads[-1]["interimText"] == ""
        assert payloads[-1]["state"] == "failed"
        for call in participant.send_text.await_args_list:
            assert call.kwargs == {
                "topic": "interview.stt",
                "destination_identities": ["candidate"],
            }

    asyncio.run(asyncio.wait_for(run(), timeout=2))


def test_slow_receiver_coalesces_updates_without_blocking_and_flushes_latest() -> None:
    async def run() -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        async def send(*_args: object, **_kwargs: object) -> None:
            entered.set()
            await release.wait()

        participant = Mock(send_text=AsyncMock(side_effect=send))
        publisher = TranscriptPublisher(participant, "candidate")
        await entered.wait()
        for index in range(1000):
            publisher.update(str(index), "")
        assert participant.send_text.await_count == 1
        release.set()
        await publisher.aclose()
        assert participant.send_text.await_count == 2
        assert json.loads(participant.send_text.await_args.args[0])["confirmedText"] == "999"

    asyncio.run(asyncio.wait_for(run(), timeout=2))


def test_close_cancels_a_stuck_delivery_without_leaking_send_task() -> None:
    async def run() -> None:
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def send(*_args: object, **_kwargs: object) -> None:
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        participant = Mock(send_text=AsyncMock(side_effect=send))
        publisher = TranscriptPublisher(participant, "candidate")
        await started.wait()
        with patch.object(publisher._idle, "wait", AsyncMock(side_effect=TimeoutError)):
            await publisher.aclose()
        assert cancelled.is_set()
        assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]

    asyncio.run(asyncio.wait_for(run(), timeout=2))


def test_reconnected_resends_confirmed_text_without_interim() -> None:
    """화면은 재연결 안내 중에 새 스냅샷을 수신하면 안내를 제거하므로 재연결 직후 바로 전송한다."""

    async def run() -> None:
        participant = Mock(send_text=AsyncMock())
        publisher = TranscriptPublisher(participant, "candidate")
        publisher.update("확정", " 끊기 전 미확정")
        publisher.reconnected()
        await publisher.aclose()
        last = json.loads(participant.send_text.await_args.args[0])
        assert (last["confirmedText"], last["interimText"], last["state"]) == (
            "확정",
            "",
            "listening",
        )

    asyncio.run(asyncio.wait_for(run(), timeout=2))
