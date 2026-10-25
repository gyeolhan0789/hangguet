import asyncio
import json
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest
from livekit import rtc

from app.agent.assignment import Assignment
from app.agent.question import (
    MAX_RPC_PAYLOAD_BYTES,
    QUESTION_METHOD,
    QuestionSpeaker,
    SpeechState,
    audio_frames,
    question_payload,
)
from app.agent.tts import AlignedChar, SpeechAudio, TtsError
from app.common.results import KST, ResultPublishError, ResultType
from app.common.session import InterviewMode, Persona

STARTED_AT = datetime(2026, 10, 22, 14, 2, 18, 250000, tzinfo=KST)
AUDIO = SpeechAudio(b"\x01\x00" * 600, (AlignedChar("질", 0, 10), AlignedChar("문", 10, 25)))
ASSIGNMENT = Assignment(
    session_id=55,
    mode=InterviewMode.VIDEO,
    persona=Persona.DEVIL,
    current_seq=1,
    questions={1: "질문"},
)


def test_started_payload_carries_alignment_and_other_states_null() -> None:
    started = json.loads(question_payload(55, 1, "질문", SpeechState.STARTED, AUDIO))
    assert started == {
        "type": "question",
        "sessionId": 55,
        "seq": 1,
        "content": "질문",
        "speech": "started",
        "alignment": {
            "chars": [
                {"char": "질", "startMs": 0, "endMs": 10},
                {"char": "문", "startMs": 10, "endMs": 25},
            ]
        },
    }
    for state in (SpeechState.ENDED, SpeechState.FAILED):
        payload = json.loads(question_payload(55, 1, "질문", state, AUDIO))
        assert payload["speech"] == state.value
        assert payload["alignment"] is None


def test_oversized_alignment_is_dropped_to_fit_rpc_limit() -> None:
    chars = tuple(AlignedChar("가", i, i + 1) for i in range(1000))
    payload = question_payload(55, 1, "질문", SpeechState.STARTED, SpeechAudio(b"\0\0", chars))
    assert len(payload.encode()) <= MAX_RPC_PAYLOAD_BYTES
    assert json.loads(payload)["alignment"] is None


def test_pcm_is_split_into_10ms_frames_with_silent_padding() -> None:
    frames = audio_frames(b"\x01\x00" * 300)  # 240 + 60 표본
    assert [frame.samples_per_channel for frame in frames] == [240, 240]
    assert bytes(frames[1].data)[120:] == b"\0" * 360


def speaker(results: Mock | None = None) -> tuple[QuestionSpeaker, Mock, Mock]:
    participant = Mock()
    participant.publish_track = AsyncMock()
    participant.perform_rpc = AsyncMock(return_value="")
    source = Mock(capture_frame=AsyncMock(), wait_for_playout=AsyncMock(), aclose=AsyncMock())
    tts = Mock()
    tts.synthesize = AsyncMock(return_value=AUDIO)
    talker = QuestionSpeaker(participant, ASSIGNMENT, tts, results, clock=lambda: STARTED_AT)
    with (
        patch("app.agent.question.rtc.AudioSource", return_value=source),
        patch("app.agent.question.rtc.LocalAudioTrack.create_audio_track") as create,
    ):
        asyncio.run(talker.publish_track())
    options = participant.publish_track.await_args.args[1]
    assert participant.publish_track.await_args.args[0] is create.return_value
    assert options.source == rtc.TrackSource.SOURCE_MICROPHONE
    return talker, participant, source


def speeches(participant: Mock) -> list[str]:
    calls = participant.perform_rpc.await_args_list
    assert all(call.kwargs["destination_identity"] == "candidate" for call in calls)
    assert all(call.kwargs["method"] == QUESTION_METHOD for call in calls)
    return [json.loads(call.kwargs["payload"])["speech"] for call in calls]


def test_question_is_announced_to_be_then_spoken_between_started_and_ended() -> None:
    results = Mock()
    talker, participant, source = speaker(results)
    order: list[str] = []
    participant.perform_rpc.side_effect = lambda **kw: order.append(
        json.loads(kw["payload"])["speech"]
    )
    source.capture_frame.side_effect = lambda _frame: order.append("frame")
    asyncio.run(talker.ask(1, "candidate", AUDIO))
    assert order == ["started", "frame", "frame", "frame", "ended"]
    source.wait_for_playout.assert_awaited_once()
    results.publish.assert_called_once_with(
        ResultType.QUESTION_STARTED, 55, {"seq": 1, "startedAt": "2026-10-22T14:02:18.250+09:00"}
    )


def test_synthesis_failure_reports_failed_but_question_still_starts() -> None:
    results = Mock()
    talker, participant, source = speaker(results)
    asyncio.run(talker.ask(1, "candidate", None))
    assert speeches(participant) == ["failed"]
    source.capture_frame.assert_not_awaited()
    results.publish.assert_called_once()


def test_prepare_returns_none_when_tts_fails() -> None:
    talker, _, _ = speaker()
    talker._tts.synthesize = AsyncMock(side_effect=TtsError("down"))  # type: ignore[method-assign]
    assert asyncio.run(talker.prepare(1)) is None


def test_prepare_synthesizes_question_with_persona_voice() -> None:
    talker, _, _ = speaker()
    assert asyncio.run(talker.prepare(1)) is AUDIO
    talker._tts.synthesize.assert_awaited_once_with("질문", Persona.DEVIL)  # type: ignore[attr-defined]


@pytest.mark.parametrize("error", [rtc.RpcError(1400, "unsupported"), TimeoutError()])
def test_screen_not_receiving_rpc_does_not_stop_voice(error: Exception) -> None:
    talker, participant, source = speaker()
    participant.perform_rpc.side_effect = error
    asyncio.run(talker.ask(1, "candidate", AUDIO))
    assert source.capture_frame.await_count == 3
    assert participant.perform_rpc.await_count == 2


def test_playback_failure_reports_failed() -> None:
    talker, participant, source = speaker()
    source.capture_frame.side_effect = RuntimeError("closed")
    asyncio.run(talker.ask(1, "candidate", AUDIO))
    assert speeches(participant) == ["started", "failed"]


def test_result_queue_failure_does_not_stop_question() -> None:
    results = Mock()
    results.publish.side_effect = ResultPublishError("redis down")
    talker, participant, _ = speaker(results)
    asyncio.run(talker.ask(1, "candidate", AUDIO))
    assert speeches(participant) == ["started", "ended"]


def test_cancel_during_playback_drops_queued_audio() -> None:
    talker, _, source = speaker()

    async def run() -> None:
        blocked = asyncio.Event()

        async def wait(_frame: Any) -> None:
            blocked.set()
            await asyncio.Event().wait()

        source.capture_frame.side_effect = wait
        task = asyncio.create_task(talker.ask(1, "candidate", AUDIO))
        await blocked.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        source.clear_queue.assert_called_once()
        source.aclose.assert_not_awaited()
        await talker.aclose()
        source.aclose.assert_awaited_once()

    asyncio.run(run())
