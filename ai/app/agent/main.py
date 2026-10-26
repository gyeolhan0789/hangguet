"""배정받은 LiveKit 방에서 지원자의 마이크를 Soniox STT로 전달하고, 질문을 음성으로 말한다.

배정 정보가 있는 면접은 InterviewRunner로 첫 질문부터 마지막 답변까지 진행한다.
배정 정보가 없는 시험 방(connect --room)은 지금처럼 자막만 처리한다.
"""

import asyncio
import logging
import os
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from contextlib import AsyncExitStack

from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, JobRequest, cli

from app.agent.answer_capture import AnswerCapture, CapturedAnswer
from app.agent.answer_delivery import AnswerDelivery
from app.agent.answer_rpc import ANSWER_STATE_METHOD, ANSWER_SUBMIT_METHOD
from app.agent.assignment import Assignment, AssignmentError, parse_assignment
from app.agent.interview import InterviewRunner
from app.agent.jev import JevJudge
from app.agent.question import QuestionSpeaker
from app.agent.reaction import CHAT_INPUT_METHOD, REACTION_METHOD, ReactionStream
from app.agent.stt import SAMPLE_RATE, SonioxSTT, SttSettings
from app.agent.transcript import TranscriptPublisher
from app.agent.tts import ElevenLabsTTS
from app.common.answer import SpeechToken
from app.common.redis import create_redis
from app.common.results import ResultPublisher
from app.common.session import InterviewMode
from app.common.settings import Settings, load_settings
from app.interview.realtime.sentence import Sentence

log = logging.getLogger(__name__)
server = AgentServer(num_idle_processes=0)
# AI 명세 6.1: 화상 녹화 파일 이름이 참가자 이름으로 시작하므로(7장) 이 이름으로 들어온다
AGENT_IDENTITY = "interviewer"
# AI 명세 6.1: 지원자 참가자 이름(BE가 발급하는 입장 토큰의 identity)
CANDIDATE_IDENTITY = "candidate"
# 화면이 응답하지 않아도 진행이 늦어지지 않도록 기다리는 상한(초)
STATE_RPC_TIMEOUT = 3.0


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
    interviewing: asyncio.Task[None] | None = None
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
        work: asyncio.Task[None]
        if assignment is not None:
            speaker = question_speaker(ctx, assignment)
            interviewing = asyncio.create_task(
                run_interview(ctx, closed, settings, speaker, assignment)
            )
            work = interviewing
        else:
            transcription = asyncio.create_task(transcribe_room(ctx, closed, settings))
            work = transcription
        stop = asyncio.create_task(closed.wait())
        try:
            done, _ = await asyncio.wait((work, stop), return_when=asyncio.FIRST_COMPLETED)
            if work in done:
                await work
        finally:
            stop.cancel()
            await asyncio.gather(stop, return_exceptions=True)
    finally:
        closed.set()
        try:
            # 면접방이 닫히면 말하던 질문 음성과 진행 중인 답변은
            # 전달할 곳이 없으므로 기다리지 않는다
            if interviewing is not None:
                interviewing.cancel()
                await asyncio.gather(interviewing, return_exceptions=True)
            if speaker is not None:
                await speaker.aclose()
            if transcription is not None:
                try:
                    await asyncio.wait_for(asyncio.shield(transcription), timeout=20)
                finally:
                    transcription.cancel()
                    await asyncio.gather(transcription, return_exceptions=True)
        finally:
            ctx.room.off("disconnected", on_disconnected)
            log.info("LiveKit 방 연결 종료")


class RoomCapture:
    """지원자 마이크를 답변 하나 동안 AnswerCapture로 전달하고 자막을 지원자 화면에 전송한다."""

    def __init__(
        self,
        room: rtc.Room,
        identity: str,
        settings: SttSettings,
        on_speech: Callable[[], None],
        on_sentence: Callable[[Sentence, str], None],
    ) -> None:
        self._room = room
        self._identity = identity
        self._stop = asyncio.Event()
        self._publisher = TranscriptPublisher(room.local_participant, identity)
        self._capture = AnswerCapture(
            lambda on_update: SonioxSTT(settings, on_update=on_update),
            on_speech=on_speech,
            on_update=self._publisher.update,
            on_sentence=on_sentence,
        )

    async def run(self) -> CapturedAnswer:
        participant = self._room.remote_participants.get(self._identity)
        if participant is None:
            raise RuntimeError("지원자가 면접방에 없다")
        stream = rtc.AudioStream.from_participant(
            participant=participant,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
            sample_rate=SAMPLE_RATE,
            num_channels=1,
        )
        chunks = audio_chunks(stream, self._stop)
        try:
            return await self._capture.run(chunks)
        finally:
            await chunks.aclose()
            await stream.aclose()

    def stop(self) -> None:
        self._stop.set()

    def snapshot(self) -> CapturedAnswer:
        return self._capture.snapshot()

    def answer_tokens(self) -> tuple[SpeechToken, ...] | None:
        return self._capture.answer_tokens()

    def fail(self) -> None:
        self._publisher.fail()

    async def aclose(self) -> None:
        self._stop.set()
        await self._publisher.aclose()


async def send_room_message(
    participant: rtc.LocalParticipant, destination: str, method: str, payload: str
) -> None:
    """화면이 받지 못해도(처리 함수 없음·응답 지연) 면접은 계속 진행한다(AI 명세 6.3)."""
    try:
        await asyncio.wait_for(
            participant.perform_rpc(
                destination_identity=destination,
                method=method,
                payload=payload,
                response_timeout=STATE_RPC_TIMEOUT,
            ),
            timeout=STATE_RPC_TIMEOUT,
        )
    except (rtc.RpcError, TimeoutError) as e:
        code = e.code if isinstance(e, rtc.RpcError) else "timeout"
        log.info("면접방 메시지 화면 전달 실패 method=%s code=%s", method, code)


async def run_interview(
    ctx: JobContext,
    closed: asyncio.Event,
    settings: SttSettings,
    speaker: QuestionSpeaker,
    assignment: Assignment,
) -> None:
    """배정 정보가 있는 면접을 진행한다.

    마지막 질문 뒤에도 BE가 면접방을 닫을 때까지 남는다(AI 명세 6.1).
    채팅 면접은 음성을 듣지 않으므로 지원자 마이크를 구독하지 않는다.
    """
    room = ctx.room
    video = assignment.mode is InterviewMode.VIDEO
    common = load_settings(os.environ)
    results = ResultPublisher(create_redis(common))
    delivery = AnswerDelivery(assignment.session_id, results, SAMPLE_RATE)
    judge = reaction_judge(common, off_topic=video)
    reactions = (
        None
        if judge is None
        else ReactionStream(
            assignment.session_id,
            judge,
            lambda destination, payload: send_room_message(
                room.local_participant, destination, REACTION_METHOD, payload
            ),
            question=assignment.question,
            criteria=assignment.criteria,
            latest_only=not video,
            persona=assignment.persona if video else None,
        )
    )
    runner = InterviewRunner(
        assignment,
        speaker,
        lambda identity, on_speech, on_sentence: RoomCapture(
            room, identity, settings, on_speech, on_sentence
        ),
        lambda destination, payload: send_room_message(
            room.local_participant, destination, ANSWER_STATE_METHOD, payload
        ),
        on_answer=delivery.deliver,
        reactions=reactions,
    )

    def subscribe(pub: rtc.RemoteTrackPublication, owner: rtc.RemoteParticipant) -> None:
        if (
            video
            and owner.identity == CANDIDATE_IDENTITY
            and pub.source == rtc.TrackSource.SOURCE_MICROPHONE
        ):
            pub.set_subscribed(True)

    def joined(participant: rtc.RemoteParticipant) -> None:
        if participant.identity != CANDIDATE_IDENTITY:
            return
        for pub in participant.track_publications.values():
            subscribe(pub, participant)
        runner.candidate_joined(participant.identity)

    def left(participant: rtc.RemoteParticipant) -> None:
        runner.candidate_left(participant.identity)

    async with AsyncExitStack() as cleanup:
        if judge is not None:
            cleanup.push_async_callback(judge.aclose)
        room.on("track_published", subscribe)
        cleanup.callback(room.off, "track_published", subscribe)
        room.on("participant_connected", joined)
        cleanup.callback(room.off, "participant_connected", joined)
        room.on("participant_disconnected", left)
        cleanup.callback(room.off, "participant_disconnected", left)
        room.local_participant.register_rpc_method(
            ANSWER_SUBMIT_METHOD, lambda data: runner.submit_requested(data.payload)
        )
        cleanup.callback(room.local_participant.unregister_rpc_method, ANSWER_SUBMIT_METHOD)
        if not video:
            room.local_participant.register_rpc_method(
                CHAT_INPUT_METHOD, lambda data: runner.chat_input_received(data.payload)
            )
            cleanup.callback(room.local_participant.unregister_rpc_method, CHAT_INPUT_METHOD)
        for participant in list(room.remote_participants.values()):
            joined(participant)
        await speaker.publish_track()
        await runner.run()
        await closed.wait()


def reaction_judge(settings: Settings, *, off_topic: bool = False) -> JevJudge | None:
    if settings.jev_api_key is None:
        # Jev 실패와 같이 리액션 없이 진행한다(AI 명세 6.5).
        # TTS와 같이 실행을 막지 않는다.
        # 리액션이 없어도 면접은 진행할 수 있기 때문이다
        log.warning("JEV_API_KEY가 없어 리액션 없이 진행한다")
        return None
    return JevJudge(settings.jev_api_key, off_topic=off_topic)


def question_speaker(ctx: JobContext, assignment: Assignment) -> QuestionSpeaker:
    common = load_settings(os.environ)
    tts = ElevenLabsTTS(common.elevenlabs_api_key)
    if not tts.configured:
        # STT와 달리 실행을 막지 않는다. 질문 음성이 없어도 화면은 질문 글로 진행한다(AI 명세 6.5)
        log.warning("ELEVENLABS_API_KEY가 없어 질문 음성 없이 진행한다")
    return QuestionSpeaker(
        ctx.room.local_participant, assignment, tts, ResultPublisher(create_redis(common))
    )


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
