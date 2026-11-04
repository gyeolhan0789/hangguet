import asyncio
import json
import logging
import threading
from collections.abc import Callable
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import pytest
from livekit import rtc

from app.agent.assignment import AssignedQuestion, Assignment
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
QUESTION = AssignedQuestion("질문", "기준")
# 250ms: 100ms 프레임 3개로 나뉜다
AUDIO = SpeechAudio(b"\x01\x00" * 6000, (AlignedChar("질", 0, 10), AlignedChar("문", 10, 25)))
ASSIGNMENT = Assignment(
    session_id=55,
    mode=InterviewMode.VIDEO,
    persona=Persona.DEVIL,
    current_seq=1,
    questions={1: QUESTION},
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


def test_pcm_is_split_into_100ms_frames_with_silent_padding() -> None:
    frames = audio_frames(b"\x01\x00" * 3000)  # 2400 + 600 표본
    assert [frame.samples_per_channel for frame in frames] == [2400, 2400]
    assert bytes(frames[1].data)[1200:] == b"\0" * 3600


def speaker(
    results: Mock | None = None, clock: Callable[[], datetime] = lambda: STARTED_AT
) -> tuple[QuestionSpeaker, Mock, Mock]:
    participant = Mock()
    participant.publish_track = AsyncMock()
    participant.perform_rpc = AsyncMock(return_value="")
    source = Mock(capture_frame=AsyncMock(), wait_for_playout=AsyncMock(), aclose=AsyncMock())
    tts = Mock()
    tts.synthesize = AsyncMock(return_value=AUDIO)
    talker = QuestionSpeaker(participant, ASSIGNMENT, tts, results, clock=clock)
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
    asyncio.run(talker.ask(1, QUESTION, "candidate", AUDIO))
    assert order == ["started", "frame", "frame", "frame", "ended"]
    source.wait_for_playout.assert_awaited_once()
    # 미리 만든 질문은 생성 버전이 없으므로 null이다(AI 명세 6.2)
    results.publish.assert_called_once_with(
        ResultType.QUESTION_STARTED,
        55,
        {
            "seq": 1,
            "startedAt": "2026-10-22T14:02:18.250+09:00",
            "content": "질문",
            "criteria": "기준",
            "promptVersion": None,
            "modelVersion": None,
        },
    )


# 기준: AI 명세 6.2 question.started(실제로 출제한 질문의 글·채점 기준·생성 버전)
def test_followup_question_is_announced_and_spoken_with_its_own_text_and_versions() -> None:
    results = Mock()
    talker, participant, _ = speaker(results)
    followup = AssignedQuestion("꼬리 질문", "꼬리 기준", "followup-v1", "gpt-5.6-terra-2026")
    asyncio.run(talker.ask(2, followup, "candidate", AUDIO))
    contents = [
        json.loads(call.kwargs["payload"])["content"]
        for call in participant.perform_rpc.await_args_list
    ]
    assert contents == ["꼬리 질문", "꼬리 질문"]
    results.publish.assert_called_once_with(
        ResultType.QUESTION_STARTED,
        55,
        {
            "seq": 2,
            "startedAt": "2026-10-22T14:02:18.250+09:00",
            "content": "꼬리 질문",
            "criteria": "꼬리 기준",
            "promptVersion": "followup-v1",
            "modelVersion": "gpt-5.6-terra-2026",
        },
    )


def recording_clock(order: list[str]) -> Callable[[], datetime]:
    def clock() -> datetime:
        order.append("clock")
        return STARTED_AT

    return clock


# 기준: AI 명세 6.2 질문(음성의 첫 소리를 송출하는 시각이 startedAt)
def test_started_at_is_taken_after_started_notice_and_before_first_frame() -> None:
    """화면 알림은 최대 3초를 기다리므로, 알림 뒤에 기록해야 다시보기 마커가 음성과 맞는다."""
    results = Mock()
    order: list[str] = []
    talker, participant, source = speaker(results, recording_clock(order))
    participant.perform_rpc.side_effect = lambda **kw: order.append(
        json.loads(kw["payload"])["speech"]
    )
    source.capture_frame.side_effect = lambda _frame: order.append("frame")
    asyncio.run(talker.ask(1, QUESTION, "candidate", AUDIO))
    assert order == ["started", "clock", "frame", "frame", "frame", "ended"]
    results.publish.assert_called_once()


# 기준: AI 명세 6.2 질문(음성 없이 출제하면 failed를 전송하기 직전 시각이 startedAt)
def test_started_at_without_audio_is_taken_when_sending_failed_notice() -> None:
    """화면 응답을 기다린 뒤 기록하면 최대 3초 늦어지므로 failed를 전송하기 전에 기록한다."""
    results = Mock()
    order: list[str] = []
    talker, participant, _ = speaker(results, recording_clock(order))
    participant.perform_rpc.side_effect = lambda **kw: order.append(
        json.loads(kw["payload"])["speech"]
    )
    asyncio.run(talker.ask(1, QUESTION, "candidate", None))
    assert order == ["clock", "failed"]
    results.publish.assert_called_once()


def test_question_cancelled_before_voice_is_not_announced_to_be() -> None:
    """음성을 송출하기 전에 면접이 끝나면 말하기 시작한 시각이 없으므로 전송하지 않는다."""
    results = Mock()
    talker, participant, source = speaker(results)

    async def run() -> None:
        notified = asyncio.Event()

        async def block(**_kw: Any) -> None:
            notified.set()
            await asyncio.Event().wait()

        participant.perform_rpc.side_effect = block
        task = asyncio.create_task(talker.ask(1, QUESTION, "candidate", AUDIO))
        await notified.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    source.capture_frame.assert_not_awaited()
    results.publish.assert_not_called()


def test_playback_failure_after_voice_starts_still_announces_to_be() -> None:
    """송출을 시작한 뒤 실패해도 질문은 출제되었으므로 BE가 질문 행을 생성해야 한다."""
    results = Mock()
    talker, _, source = speaker(results)
    source.capture_frame.side_effect = RuntimeError("closed")
    asyncio.run(talker.ask(1, QUESTION, "candidate", AUDIO))
    results.publish.assert_called_once()


# 기준: BE 설계 5.3(질문 행이 없으면 answer.completed를 저장하지 않음)
def test_question_ends_only_after_question_started_is_sent() -> None:
    """question.started 전송이 끝나기 전에는 질문 말하기가 끝나지 않는다.

    답변은 질문 말하기가 끝난 뒤에 듣기 시작하므로,
    answer.completed가 질문 행을 생성하는 question.started보다 먼저 전송되지 않는다.
    """
    results = Mock()
    publishing = threading.Event()
    sent = threading.Event()

    def publish(*_args: Any, **_kwargs: Any) -> None:
        publishing.set()
        sent.wait(timeout=5)

    results.publish.side_effect = publish
    talker, _, _ = speaker(results)

    async def run() -> None:
        asking = asyncio.create_task(talker.ask(1, QUESTION, "candidate", AUDIO))
        await asyncio.to_thread(publishing.wait, 5)
        # 전송 대기 코드가 없으면 시험의 가짜 음성 송출이 바로 끝나므로,
        # 0.3초 동안 질문 말하기가 끝나지 않는지 확인한다
        done, _ = await asyncio.wait({asking}, timeout=0.3)
        assert not done
        sent.set()
        await asyncio.wait_for(asking, timeout=5)

    asyncio.run(run())
    results.publish.assert_called_once()


def test_prepare_synthesizes_given_question_not_assignment() -> None:
    talker, _, _ = speaker()
    asyncio.run(talker.prepare(2, AssignedQuestion("꼬리 질문", "꼬리 기준")))
    talker._tts.synthesize.assert_awaited_once_with("꼬리 질문", Persona.DEVIL)  # type: ignore[attr-defined]


# 기준: AI 명세 6.5 지원자 퇴장·새로고침(재입장 뒤 다시 말할 때 question.started 재전송 안 함)
def test_repeated_question_is_announced_to_be_only_once() -> None:
    """BE가 질문 행을 처음 시작 시각으로 이미 저장했으므로 다시 말해도 전송하지 않는다."""
    results = Mock()
    talker, participant, _ = speaker(results)

    async def run() -> None:
        await talker.ask(1, QUESTION, "candidate", AUDIO)
        await talker.ask(1, QUESTION, "candidate", AUDIO)

    asyncio.run(run())
    assert speeches(participant) == ["started", "ended", "started", "ended"]
    results.publish.assert_called_once()


def test_question_left_before_voice_is_announced_when_spoken_again() -> None:
    """음성을 송출하기 전에 퇴장했으면 전송하지 않았으므로,
    다시 말하며 소리를 낼 때 전송한다.

    전송하지 않으면 BE에 질문 행이 생성되지 않아 그 질문의 답변을 저장할 수 없다.
    """
    results = Mock()
    order: list[str] = []
    talker, participant, source = speaker(results, recording_clock(order))
    source.capture_frame.side_effect = lambda _frame: order.append("frame")

    async def run() -> None:
        notified = asyncio.Event()

        async def block(**_kw: Any) -> None:
            notified.set()
            await asyncio.Event().wait()

        participant.perform_rpc.side_effect = block
        first = asyncio.create_task(talker.ask(1, QUESTION, "candidate", AUDIO))
        await notified.wait()
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        participant.perform_rpc.side_effect = None
        await talker.ask(1, QUESTION, "candidate", AUDIO)

    asyncio.run(run())
    assert order == ["clock", "frame", "frame", "frame"]
    results.publish.assert_called_once()


def test_synthesis_failure_reports_failed_but_question_still_starts() -> None:
    results = Mock()
    talker, participant, source = speaker(results)
    asyncio.run(talker.ask(1, QUESTION, "candidate", None))
    assert speeches(participant) == ["failed"]
    source.capture_frame.assert_not_awaited()
    results.publish.assert_called_once()


def test_prepare_returns_none_when_tts_fails() -> None:
    talker, _, _ = speaker()
    talker._tts.synthesize = AsyncMock(side_effect=TtsError("down"))  # type: ignore[method-assign]
    assert asyncio.run(talker.prepare(1, QUESTION)) is None


def test_prepare_synthesizes_question_with_persona_voice() -> None:
    talker, _, _ = speaker()
    assert asyncio.run(talker.prepare(1, QUESTION)) is AUDIO
    talker._tts.synthesize.assert_awaited_once_with("질문", Persona.DEVIL)  # type: ignore[attr-defined]


@pytest.mark.parametrize("error", [rtc.RpcError(1400, "unsupported"), TimeoutError()])
def test_screen_not_receiving_rpc_does_not_stop_voice(error: Exception) -> None:
    talker, participant, source = speaker()
    participant.perform_rpc.side_effect = error
    asyncio.run(talker.ask(1, QUESTION, "candidate", AUDIO))
    assert source.capture_frame.await_count == 3
    assert participant.perform_rpc.await_count == 2


def test_playback_failure_reports_failed() -> None:
    talker, participant, source = speaker()
    source.capture_frame.side_effect = RuntimeError("closed")
    asyncio.run(talker.ask(1, QUESTION, "candidate", AUDIO))
    assert speeches(participant) == ["started", "failed"]


def test_result_queue_failure_does_not_stop_question() -> None:
    results = Mock()
    results.publish.side_effect = ResultPublishError("redis down")
    talker, participant, _ = speaker(results)
    asyncio.run(talker.ask(1, QUESTION, "candidate", AUDIO))
    assert speeches(participant) == ["started", "ended"]


def test_cancel_during_playback_drops_queued_audio() -> None:
    talker, _, source = speaker()

    async def run() -> None:
        blocked = asyncio.Event()

        async def wait(_frame: Any) -> None:
            blocked.set()
            await asyncio.Event().wait()

        source.capture_frame.side_effect = wait
        task = asyncio.create_task(talker.ask(1, QUESTION, "candidate", AUDIO))
        await blocked.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        source.clear_queue.assert_called_once()
        source.aclose.assert_not_awaited()
        await talker.aclose()
        source.aclose.assert_awaited_once()

    asyncio.run(run())


def test_notice_is_spoken_on_same_track_without_question_messages() -> None:
    results = Mock()
    talker, participant, source = speaker(results)
    asyncio.run(talker.say(AUDIO))
    assert source.capture_frame.await_count == 3
    source.wait_for_playout.assert_awaited_once()
    participant.perform_rpc.assert_not_awaited()
    results.publish.assert_not_called()


def test_notice_is_synthesized_with_persona_voice_and_failure_is_none() -> None:
    talker, _, _ = speaker()
    assert asyncio.run(talker.prepare_notice("핵심만 짧게 말씀해 주세요.")) is AUDIO
    talker._tts.synthesize.assert_awaited_once_with("핵심만 짧게 말씀해 주세요.", Persona.DEVIL)  # type: ignore[attr-defined]
    talker._tts.synthesize = AsyncMock(side_effect=TtsError("down"))  # type: ignore[method-assign]
    assert asyncio.run(talker.prepare_notice("안내")) is None


def timed_speaker(tts: Mock, *ticks: float) -> QuestionSpeaker:
    clock = iter(ticks)
    return QuestionSpeaker(Mock(), ASSIGNMENT, tts, None, timer=lambda: next(clock))


def test_synthesis_time_is_logged_in_milliseconds(caplog: pytest.LogCaptureFixture) -> None:
    tts = Mock(synthesize=AsyncMock(return_value=AUDIO))
    talker = timed_speaker(tts, 10.0, 11.25, 20.0, 20.5)
    with caplog.at_level(logging.INFO, logger="app.agent.question"):
        asyncio.run(talker.prepare(1, QUESTION))
        asyncio.run(talker.prepare_notice("안내"))
    assert [record.getMessage() for record in caplog.records] == [
        "질문 음성 합성 완료 ms=1250 chars=2",
        "발화 중단 안내 음성 합성 완료 ms=500 chars=2",
    ]


def test_synthesis_failure_keeps_alert_phrase_and_adds_time(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Infra 경보가 기존 실패 문구로 건수를 세므로 문구는 그대로 두고 시간만 덧붙인다."""
    tts = Mock(synthesize=AsyncMock(side_effect=TtsError("ElevenLabs 합성 실패 (status=500)")))
    talker = timed_speaker(tts, 0.0, 2.0, 5.0, 5.3)
    with caplog.at_level(logging.INFO, logger="app.agent.question"):
        asyncio.run(talker.prepare(1, QUESTION))
        asyncio.run(talker.prepare_notice("안내"))
    assert [record.getMessage() for record in caplog.records] == [
        "질문 음성 합성 실패: ElevenLabs 합성 실패 (status=500) ms=2000",
        "발화 중단 안내 음성 합성 실패: ElevenLabs 합성 실패 (status=500) ms=300",
    ]
