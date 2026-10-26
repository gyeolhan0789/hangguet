"""배정받은 LiveKit 방에서 질문을 차례로 말하고, 지원자의 답변을 Soniox STT로 듣는다.

배정이 없는 테스트 방(connect --room)에서는 질문 없이 지원자의 음성 인식 결과만 보낸다.
"""

import asyncio
import logging
import os
from contextlib import AsyncExitStack

from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, JobRequest, cli

from app.agent.assignment import Assignment, AssignmentError, parse_assignment
from app.agent.capture import audio_chunks
from app.agent.interview import InterviewConductor
from app.agent.question import QuestionSpeaker
from app.agent.stt import SAMPLE_RATE, SonioxSTT, SttSettings
from app.agent.transcript import TranscriptPublisher
from app.agent.tts import ElevenLabsTTS
from app.common.redis import create_redis
from app.common.results import ResultPublisher
from app.common.session import InterviewMode
from app.common.settings import load_settings

log = logging.getLogger(__name__)
server = AgentServer(num_idle_processes=0)
# AI 명세 6.1: 화상 녹화 파일 이름이 참가자 이름으로 시작하므로(7장) 이 이름으로 들어온다
AGENT_IDENTITY = "interviewer"


async def accept_request(request: JobRequest) -> None:
    """형식이 틀린 배정 정보로 온 배정은 방에 들어가기 전에 거절한다.

    배정 정보가 있으면 BE가 연 실제 면접이고(AI 명세 6.1), 틀린 배정 정보로는 질문을 진행할 수 없다.
    방에 들어가 자막만 보내면 지원자는 오지 않을 질문을 기다리게 된다.
    같은 배정 정보로는 다른 작업자도 진행할 수 없으므로 다른 작업자에게 넘기지 않는다.
    """
    metadata = _metadata(request.job.metadata)
    if metadata is not None:
        try:
            parse_assignment(metadata)
        except AssignmentError as e:
            log.error("배정 정보가 올바르지 않아 배정을 거절한다: %s", e)
            await request.reject(terminate=True)
            return
    await request.accept(name=AGENT_IDENTITY, identity=AGENT_IDENTITY)


def job_assignment(ctx: JobContext) -> Assignment | None:
    """BE 배정 없이 테스트 방에 직접 연결하면(connect --room) 배정 정보가 없어 질문하지 않는다.

    형식이 틀린 배정 정보는 accept_request가 거절하므로 여기까지 오지 않는다.
    """
    metadata = _metadata(ctx.job.metadata)
    return None if metadata is None else parse_assignment(metadata)


def _metadata(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


async def entrypoint(ctx: JobContext) -> None:
    settings = SttSettings.from_env(os.environ)
    assignment = job_assignment(ctx)
    closed = asyncio.Event()
    transcription: asyncio.Task[None] | None = None
    speaker: QuestionSpeaker | None = None

    def on_disconnected(_reason: rtc.DisconnectReason) -> None:
        closed.set()

    async def on_shutdown() -> None:
        closed.set()

    ctx.room.on("disconnected", on_disconnected)
    ctx.add_shutdown_callback(on_shutdown)
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
        log.info("LiveKit 방 참가 완료", extra={"room": ctx.room.name})
        if assignment is None:
            transcription = asyncio.create_task(transcribe_room(ctx, closed, settings))
        else:
            # 질문 시작(question.started)과 답변 완료(answer.completed)를 같은 결과 큐로 보낸다
            results = ResultPublisher(create_redis(load_settings(os.environ)))
            speaker = question_speaker(ctx, assignment, results)
            transcription = asyncio.create_task(
                conduct_interview(ctx, closed, assignment, speaker, results, settings)
            )
        stop = asyncio.create_task(closed.wait())
        try:
            done, _ = await asyncio.wait((transcription, stop), return_when=asyncio.FIRST_COMPLETED)
            if transcription in done:
                await transcription
        finally:
            stop.cancel()
            await asyncio.gather(stop, return_exceptions=True)
    finally:
        closed.set()
        try:
            # 질문을 말하던 진행 작업을 먼저 멈춘 뒤 질문 음성을 닫는다(닫힌 음성에 쓰지 않게)
            if transcription is not None:
                try:
                    await asyncio.wait_for(asyncio.shield(transcription), timeout=20)
                finally:
                    transcription.cancel()
                    await asyncio.gather(transcription, return_exceptions=True)
        finally:
            try:
                if speaker is not None:
                    await speaker.aclose()
            finally:
                ctx.room.off("disconnected", on_disconnected)
                log.info("LiveKit 방 연결 종료")


def question_speaker(
    ctx: JobContext, assignment: Assignment, results: ResultPublisher
) -> QuestionSpeaker:
    common = load_settings(os.environ)
    tts = ElevenLabsTTS(common.elevenlabs_api_key)
    if not tts.configured:
        # STT와 달리 실행을 막지 않는다. 질문 음성이 없어도 화면은 질문 글로 진행한다(AI 명세 6.5)
        log.warning("ELEVENLABS_API_KEY가 없어 질문 음성 없이 진행한다")
    return QuestionSpeaker(ctx.room.local_participant, assignment, tts, results)


async def conduct_interview(
    ctx: JobContext,
    closed: asyncio.Event,
    assignment: Assignment,
    speaker: QuestionSpeaker,
    results: ResultPublisher,
    settings: SttSettings,
) -> None:
    """질문을 currentSeq부터 차례로 진행한다(app.agent.interview).

    5번 답변 뒤에는 방이 닫힐 때까지 기다리고, 방이 닫히면 진행 중이던 질문·답변을 멈춘다.
    질문 진행 오류로 면접방에서 나가지 않게 이 작업 안에서 끝낸다.
    """
    video = assignment.mode is InterviewMode.VIDEO
    if video:
        ctx.room.on("track_published", subscribe_microphone)
        for participant in ctx.room.remote_participants.values():
            for pub in participant.track_publications.values():
                subscribe_microphone(pub, participant)
    conductor = InterviewConductor(
        ctx.room,
        assignment,
        speaker,
        results,
        settings if video else None,
        lambda: first_participant(ctx, closed),
    )
    running = asyncio.create_task(conductor.run())
    stop = asyncio.create_task(closed.wait())
    try:
        await asyncio.wait((running, stop), return_when=asyncio.FIRST_COMPLETED)
        if not running.done():
            running.cancel()
        await asyncio.gather(running, return_exceptions=True)
        if not running.cancelled() and running.exception() is not None:
            log.error("질문 진행 실패", exc_info=running.exception())
        await closed.wait()
    finally:
        running.cancel()
        stop.cancel()
        await asyncio.gather(running, stop, return_exceptions=True)
        conductor.aclose()
        if video:
            ctx.room.off("track_published", subscribe_microphone)


def subscribe_microphone(pub: rtc.RemoteTrackPublication, _owner: rtc.RemoteParticipant) -> None:
    if pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
        pub.set_subscribed(True)


async def first_participant(ctx: JobContext, closed: asyncio.Event) -> rtc.RemoteParticipant | None:
    waiting = asyncio.create_task(ctx.wait_for_participant())
    stop = asyncio.create_task(closed.wait())
    try:
        done, _ = await asyncio.wait((waiting, stop), return_when=asyncio.FIRST_COMPLETED)
        return None if stop in done else waiting.result()
    finally:
        waiting.cancel()
        stop.cancel()
        await asyncio.gather(waiting, stop, return_exceptions=True)


async def transcribe_room(ctx: JobContext, closed: asyncio.Event, settings: SttSettings) -> None:
    while not closed.is_set():
        if not await transcribe_participant(ctx, closed, settings):
            return


async def transcribe_participant(
    ctx: JobContext, closed: asyncio.Event, settings: SttSettings
) -> bool:
    participant = await first_participant(ctx, closed)
    if participant is None:
        return False

    def subscribe(pub: rtc.RemoteTrackPublication, owner: rtc.RemoteParticipant) -> None:
        if (
            owner.identity == participant.identity
            and pub.source == rtc.TrackSource.SOURCE_MICROPHONE
        ):
            pub.set_subscribed(True)

    capture_closed = asyncio.Event()
    participant_left = False

    async def stop_with_room() -> None:
        await closed.wait()
        capture_closed.set()

    def on_left(owner: rtc.RemoteParticipant) -> None:
        nonlocal participant_left
        if owner.identity == participant.identity:
            participant_left = True
            capture_closed.set()

    publisher = TranscriptPublisher(ctx.room.local_participant, participant.identity)
    stt = SonioxSTT(settings, on_update=publisher.update)
    room_stop = asyncio.create_task(stop_with_room())
    try:
        async with AsyncExitStack() as cleanup:
            ctx.room.on("track_published", subscribe)
            cleanup.callback(ctx.room.off, "track_published", subscribe)
            ctx.room.on("participant_disconnected", on_left)
            cleanup.callback(ctx.room.off, "participant_disconnected", on_left)
            stream = rtc.AudioStream.from_participant(
                participant=participant,
                track_source=rtc.TrackSource.SOURCE_MICROPHONE,
                sample_rate=SAMPLE_RATE,
                num_channels=1,
            )
            cleanup.push_async_callback(stream.aclose)
            chunks = audio_chunks(stream, capture_closed)
            cleanup.push_async_callback(chunks.aclose)
            for pub in participant.track_publications.values():
                subscribe(pub, participant)
            await stt.run(chunks)
    except Exception:
        publisher.fail()
        raise
    finally:
        try:
            room_stop.cancel()
            await asyncio.gather(room_stop, return_exceptions=True)
        finally:
            try:
                await publisher.aclose()
            finally:
                log.info("STT 수집 종료", extra={"token_count": stt.transcript.final_count})
    return participant_left and not closed.is_set()


server.rtc_session(
    entrypoint,
    agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "a301-interviewer"),
    on_request=accept_request,
)


def main() -> None:
    SttSettings.from_env(os.environ)
    cli.run_app(server)


if __name__ == "__main__":
    main()
