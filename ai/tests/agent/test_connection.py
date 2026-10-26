from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, Mock, patch

import pytest
from livekit import rtc
from livekit.agents import AutoSubscribe

from app.agent.assignment import parse_assignment
from app.agent.jev import JevJudge
from app.agent.main import (
    accept_request,
    audio_chunks,
    entrypoint,
    job_assignment,
    main,
    question_speaker,
    reaction_judge,
    run_interview,
    server,
    transcribe_participant,
    transcribe_room,
)
from app.agent.stt import SttSettings
from app.common.settings import load_settings


@pytest.fixture(autouse=True)
def stt_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SONIOX_API_KEY", "test-key")


def context() -> Mock:
    ctx = Mock()
    ctx.connect = AsyncMock()
    ctx.room.local_participant.send_text = AsyncMock()

    async def waiting() -> None:
        await asyncio.Event().wait()

    ctx.wait_for_participant = AsyncMock(side_effect=waiting)
    return ctx


def test_room_disconnect_releases_job_waiting_for_participant() -> None:
    async def run() -> None:
        ctx = context()
        task = asyncio.create_task(entrypoint(ctx))
        await asyncio.sleep(0)
        assert not task.done()
        ctx.connect.assert_awaited_once_with(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
        on_disconnected = ctx.room.on.call_args.args[1]
        on_disconnected(0)
        await asyncio.wait_for(task, timeout=1)
        ctx.room.off.assert_called_once_with("disconnected", on_disconnected)

    asyncio.run(run())


def test_server_shutdown_releases_waiting_job() -> None:
    async def run() -> None:
        ctx = context()
        task = asyncio.create_task(entrypoint(ctx))
        await asyncio.sleep(0)
        on_shutdown = ctx.add_shutdown_callback.call_args.args[0]
        await on_shutdown()
        await asyncio.wait_for(task, timeout=1)
        ctx.room.off.assert_called_once()

    asyncio.run(run())


def test_connection_failure_does_not_leave_listener() -> None:
    ctx = context()
    ctx.connect = AsyncMock(side_effect=ConnectionError("unavailable"))
    with pytest.raises(ConnectionError):
        asyncio.run(entrypoint(ctx))
    ctx.room.off.assert_called_once_with("disconnected", ctx.room.on.call_args.args[1])


def test_main_starts_only_the_agent_server() -> None:
    with patch("app.agent.main.cli.run_app") as run_app:
        main()
    run_app.assert_called_once_with(server)


def test_only_selected_participants_microphone_is_subscribed() -> None:
    async def run() -> None:
        ctx = context()
        participant = Mock(identity="applicant")
        mic = Mock(source=rtc.TrackSource.SOURCE_MICROPHONE)
        camera = Mock(source=rtc.TrackSource.SOURCE_CAMERA)
        participant.track_publications = {"mic": mic, "camera": camera}
        ctx.wait_for_participant = AsyncMock(return_value=participant)
        stream = Mock(aclose=AsyncMock())
        closed = asyncio.Event()

        async def recognizing(_chunks: object) -> None:
            handlers = {call.args[0]: call.args[1] for call in ctx.room.on.call_args_list}
            foreign_mic = Mock(source=rtc.TrackSource.SOURCE_MICROPHONE)
            handlers["track_published"](foreign_mic, Mock(identity="other"))
            foreign_mic.set_subscribed.assert_not_called()
            handlers["track_published"](mic, participant)
            handlers["participant_disconnected"](Mock(identity="other"))
            assert not closed.is_set()
            handlers["participant_disconnected"](participant)
            assert not closed.is_set()

        with (
            patch("app.agent.main.rtc.AudioStream.from_participant", return_value=stream),
            patch("app.agent.main.SonioxSTT") as factory,
        ):
            factory.return_value.run = AsyncMock(side_effect=recognizing)
            factory.return_value.transcript.final_count = 0
            await transcribe_participant(ctx, closed, SttSettings(api_key="test"))
        assert mic.set_subscribed.call_count == 2
        camera.set_subscribed.assert_not_called()
        stream.aclose.assert_awaited_once()
        assert ctx.room.off.call_count == 2

    asyncio.run(run())


def test_candidate_leave_waits_for_rejoin_without_ending_room_job() -> None:
    async def run() -> None:
        ctx = context()
        closed = asyncio.Event()
        second_capture = asyncio.Event()

        async def capture(*_args: object) -> bool:
            if not second_capture.is_set():
                second_capture.set()
                return True
            await closed.wait()
            return False

        with patch("app.agent.main.transcribe_participant", side_effect=capture) as recognize:
            task = asyncio.create_task(transcribe_room(ctx, closed, SttSettings("test")))
            await second_capture.wait()
            assert not task.done()
            assert not closed.is_set()
            closed.set()
            await asyncio.wait_for(task, timeout=1)
            assert recognize.await_count == 2

    asyncio.run(run())


def test_rejoined_candidate_gets_new_capture_and_stream_id() -> None:
    async def run() -> None:
        ctx = context()
        participants = [Mock(identity="candidate", track_publications={}) for _ in range(2)]
        ctx.wait_for_participant = AsyncMock(side_effect=participants)
        streams = [Mock(aclose=AsyncMock()) for _ in range(2)]
        closed = asyncio.Event()
        captures = 0

        async def recognize(_chunks: object) -> None:
            nonlocal captures
            captures += 1
            if captures == 1:
                handlers = {call.args[0]: call.args[1] for call in ctx.room.on.call_args_list}
                handlers["participant_disconnected"](participants[0])
                assert not closed.is_set()
            else:
                closed.set()

        with (
            patch("app.agent.main.rtc.AudioStream.from_participant", side_effect=streams),
            patch("app.agent.main.SonioxSTT.run", side_effect=recognize),
        ):
            await asyncio.wait_for(transcribe_room(ctx, closed, SttSettings("test")), timeout=1)
        assert captures == 2
        assert ctx.wait_for_participant.await_count == 2
        for stream in streams:
            stream.aclose.assert_awaited_once()
        snapshots = [
            json.loads(call.args[0])
            for call in ctx.room.local_participant.send_text.await_args_list
        ]
        assert len({snapshot["streamId"] for snapshot in snapshots}) == 2
        assert ctx.room.off.call_count == 4

    asyncio.run(run())


def test_room_listener_is_removed_when_stt_fails() -> None:
    async def fail(*_args: object) -> None:
        raise ConnectionError("stt unavailable")

    async def run() -> None:
        ctx = context()
        with (
            patch("app.agent.main.transcribe_participant", side_effect=fail),
            pytest.raises(ConnectionError, match="stt unavailable"),
        ):
            await entrypoint(ctx)
        ctx.room.off.assert_called_once()

    asyncio.run(run())


def test_stt_failure_sends_targeted_failure_and_closes_stream() -> None:
    async def run() -> None:
        ctx = context()
        ctx.wait_for_participant = AsyncMock(
            return_value=Mock(identity="candidate", track_publications={})
        )
        stream = Mock(aclose=AsyncMock())
        with (
            patch("app.agent.main.rtc.AudioStream.from_participant", return_value=stream),
            patch("app.agent.main.SonioxSTT.run", side_effect=ConnectionError("unavailable")),
            pytest.raises(ConnectionError, match="unavailable"),
        ):
            await transcribe_participant(ctx, asyncio.Event(), SttSettings("test"))
        deliveries = ctx.room.local_participant.send_text.await_args_list
        assert json.loads(deliveries[-1].args[0])["state"] == "failed"
        assert deliveries[-1].kwargs["destination_identities"] == ["candidate"]
        stream.aclose.assert_awaited_once()
        assert ctx.room.off.call_count == 2

    asyncio.run(run())


@pytest.mark.parametrize("failure", ["create", "close"])
def test_audio_stream_errors_still_remove_listeners(failure: str) -> None:
    async def run() -> None:
        ctx = context()
        ctx.wait_for_participant = AsyncMock(return_value=Mock(track_publications={}))
        stream = Mock(aclose=AsyncMock(side_effect=RuntimeError("stream close failed")))
        with (
            patch("app.agent.main.rtc.AudioStream.from_participant") as factory,
            patch("app.agent.main.SonioxSTT") as stt,
        ):
            if failure == "create":
                factory.side_effect = RuntimeError("stream create failed")
            else:
                factory.return_value = stream
            stt.return_value.run = AsyncMock()
            stt.return_value.transcript.final_count = 0
            with pytest.raises(RuntimeError, match=f"stream {failure} failed"):
                await transcribe_participant(ctx, asyncio.Event(), SttSettings("test"))
        assert ctx.room.off.call_count == 2

    asyncio.run(run())


def test_closing_room_cancels_pending_audio_read() -> None:
    async def run() -> None:
        cancelled = asyncio.Event()
        closed = asyncio.Event()

        class Stream:
            def __aiter__(self) -> Stream:
                return self

            async def __anext__(self) -> rtc.AudioFrameEvent:
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
                raise StopAsyncIteration

        stream = Stream()
        chunks = audio_chunks(stream, closed)
        reading = asyncio.create_task(anext(chunks))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        closed.set()
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(reading, timeout=1)
        assert cancelled.is_set()

    asyncio.run(run())


def test_agent_joins_as_interviewer() -> None:
    request = Mock(accept=AsyncMock())
    asyncio.run(accept_request(request))
    request.accept.assert_awaited_once_with(name="interviewer", identity="interviewer")


@pytest.mark.parametrize(
    "metadata", [pytest.param("", id="test room"), pytest.param(None, id="no metadata")]
)
def test_request_without_be_assignment_is_accepted(metadata: str | None) -> None:
    # BE 배정 없이 시험 방에 직접 연결하는 경우(connect --room)다
    request = Mock(accept=AsyncMock(), reject=AsyncMock())
    request.job.metadata = metadata
    asyncio.run(accept_request(request))
    request.accept.assert_awaited_once_with(name="interviewer", identity="interviewer")
    request.reject.assert_not_awaited()


def test_request_with_valid_assignment_is_accepted() -> None:
    request = Mock(accept=AsyncMock(), reject=AsyncMock())
    request.job.metadata = ASSIGNMENT_JSON
    asyncio.run(accept_request(request))
    request.accept.assert_awaited_once()
    request.reject.assert_not_awaited()


@pytest.mark.parametrize(
    "metadata",
    [
        pytest.param("{broken", id="not json"),
        pytest.param(json.dumps({"sessionId": 55}), id="missing fields"),
    ],
)
def test_request_with_malformed_assignment_is_rejected_without_joining(metadata: str) -> None:
    # 틀린 배정 정보로는 질문을 진행할 수 없으므로 방에 들어가지 않고,
    # 같은 배정 정보로 다른 작업자가 다시 받지 않게 한다
    request = Mock(accept=AsyncMock(), reject=AsyncMock())
    request.job.metadata = metadata
    asyncio.run(accept_request(request))
    request.reject.assert_awaited_once_with(terminate=True)
    request.accept.assert_not_awaited()


def test_room_without_be_assignment_does_not_ask_questions() -> None:
    ctx = context()
    ctx.job.metadata = ""
    assert job_assignment(ctx) is None


def test_be_assignment_is_read_from_job_metadata() -> None:
    ctx = context()
    ctx.job.metadata = ASSIGNMENT_JSON
    assignment = job_assignment(ctx)
    assert assignment is not None
    assert assignment.session_id == 55
    assert assignment.current_seq == 1


@pytest.mark.parametrize("mode", ["VIDEO", "CHAT"])
def test_assigned_room_runs_interview_and_releases_voice_on_close(mode: str) -> None:
    async def run() -> None:
        ctx = context()
        ctx.job.metadata = ASSIGNMENT_JSON.replace("VIDEO", mode)
        speaker = Mock(aclose=AsyncMock())
        started = asyncio.Event()

        async def interviewing(*_args: object) -> None:
            started.set()
            await asyncio.Event().wait()

        with (
            patch("app.agent.main.question_speaker", return_value=speaker),
            patch("app.agent.main.run_interview", side_effect=interviewing) as interview,
            patch("app.agent.main.transcribe_room") as transcribe,
        ):
            task = asyncio.create_task(entrypoint(ctx))
            await started.wait()
            assert interview.call_args.args[3] is speaker
            transcribe.assert_not_called()
            ctx.room.on.call_args_list[0].args[1](0)
            await asyncio.wait_for(task, timeout=1)
        speaker.aclose.assert_awaited_once()

    asyncio.run(run())


@pytest.mark.parametrize(("mode", "subscribed"), [("VIDEO", True), ("CHAT", False)])
def test_interview_subscribes_candidate_microphone_only_for_video(
    mode: str, subscribed: bool
) -> None:
    async def run() -> None:
        ctx = context()
        assignment = parse_assignment(ASSIGNMENT_JSON.replace("VIDEO", mode))
        mic = Mock(source=rtc.TrackSource.SOURCE_MICROPHONE)
        candidate = Mock(identity="candidate", track_publications={"mic": mic})
        ctx.room.remote_participants = {"candidate": candidate}
        speaker = Mock(publish_track=AsyncMock())
        closed = asyncio.Event()
        closed.set()
        with patch("app.agent.main.InterviewRunner") as runner:
            runner.return_value.run = AsyncMock()
            await run_interview(ctx, closed, SttSettings(api_key="test"), speaker, assignment)
        assert mic.set_subscribed.called is subscribed
        runner.return_value.candidate_joined.assert_called_once_with("candidate")

    asyncio.run(run())


def test_question_speaker_uses_elevenlabs_key_and_result_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ELEVENLABS_API_KEY", "voice-key")
    ctx = context()
    assignment = parse_assignment(ASSIGNMENT_JSON)
    with (
        patch("app.agent.main.QuestionSpeaker") as speaker,
        patch("app.agent.main.create_redis") as redis,
    ):
        question_speaker(ctx, assignment)
    participant, given, tts, results = speaker.call_args.args
    assert participant is ctx.room.local_participant
    assert given is assignment
    assert tts.configured
    assert results._client is redis.return_value


ASSIGNMENT_JSON = json.dumps(
    {
        "sessionId": 55,
        "mode": "VIDEO",
        "persona": "DEVIL",
        "currentSeq": 1,
        "questions": [{"seq": seq, "content": "질문", "criteria": "기준"} for seq in range(1, 6)],
    }
)


def test_reactions_are_skipped_without_jev_key() -> None:
    """Jev 키가 없으면 Jev 실패와 같이 리액션 없이 진행한다(AI 명세 6.5)."""
    assert reaction_judge(load_settings({})) is None
    assert isinstance(reaction_judge(load_settings({"JEV_API_KEY": "jev-key"})), JevJudge)
