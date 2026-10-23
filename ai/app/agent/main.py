"""배정받은 LiveKit 방에서 지원자의 마이크를 Soniox STT로 전달한다."""

import asyncio
import logging
import os
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import AsyncExitStack

from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, cli

from app.agent.stt import SAMPLE_RATE, SonioxSTT, SttSettings
from app.agent.transcript import TranscriptPublisher

log = logging.getLogger(__name__)
server = AgentServer(num_idle_processes=0)


async def entrypoint(ctx: JobContext) -> None:
    settings = SttSettings.from_env(os.environ)
    closed = asyncio.Event()
    transcription: asyncio.Task[None] | None = None

    def on_disconnected(_reason: rtc.DisconnectReason) -> None:
        closed.set()

    async def on_shutdown() -> None:
        closed.set()

    ctx.room.on("disconnected", on_disconnected)
    ctx.add_shutdown_callback(on_shutdown)
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_NONE)
        log.info("LiveKit 방 참가 완료", extra={"room": ctx.room.name})
        transcription = asyncio.create_task(transcribe_room(ctx, closed, settings))
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
            if transcription is not None:
                try:
                    await asyncio.wait_for(asyncio.shield(transcription), timeout=20)
                finally:
                    transcription.cancel()
                    await asyncio.gather(transcription, return_exceptions=True)
        finally:
            ctx.room.off("disconnected", on_disconnected)
            log.info("LiveKit 방 연결 종료")


async def audio_chunks(
    stream: AsyncIterator[rtc.AudioFrameEvent], closed: asyncio.Event
) -> AsyncGenerator[bytes]:
    stop = asyncio.create_task(closed.wait())
    frame: asyncio.Future[rtc.AudioFrameEvent] | None = None
    try:
        while not closed.is_set():
            frame = asyncio.ensure_future(anext(stream))
            done, _ = await asyncio.wait((frame, stop), return_when=asyncio.FIRST_COMPLETED)
            if stop in done:
                break
            try:
                yield bytes(frame.result().frame.data)
            except StopAsyncIteration:
                return
    finally:
        stop.cancel()
        if frame is not None:
            frame.cancel()
        await asyncio.gather(stop, *([frame] if frame is not None else []), return_exceptions=True)


async def transcribe_room(ctx: JobContext, closed: asyncio.Event, settings: SttSettings) -> None:
    while not closed.is_set():
        if not await transcribe_participant(ctx, closed, settings):
            return


async def transcribe_participant(
    ctx: JobContext, closed: asyncio.Event, settings: SttSettings
) -> bool:
    waiting = asyncio.create_task(ctx.wait_for_participant())
    stop = asyncio.create_task(closed.wait())
    try:
        done, _ = await asyncio.wait((waiting, stop), return_when=asyncio.FIRST_COMPLETED)
        if stop in done:
            return False
        participant = waiting.result()
    finally:
        waiting.cancel()
        stop.cancel()
        await asyncio.gather(waiting, stop, return_exceptions=True)

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
                log.info("STT 수집 종료", extra={"token_count": len(stt.tokens)})
    return participant_left and not closed.is_set()


server.rtc_session(entrypoint, agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "a301-interviewer"))


def main() -> None:
    SttSettings.from_env(os.environ)
    cli.run_app(server)


if __name__ == "__main__":
    main()
