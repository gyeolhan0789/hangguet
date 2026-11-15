"""그룹 면접에서 BE가 정한 차례대로 질문을 말하고 지금 답변자의 답변을 듣는다.

기준: AI 명세 6.7 그룹 면접(진행 · 면접방 메시지 · 결과 메시지),
6.2~6.6(다르다고 적은 것 말고는 그대로), BE 그룹 면접 설계 6.4~6.6 · 6.9.
- 진행 상태의 주인은 BE다. 에이전트는 면접방 정보(group_room)의 단계를 따라 움직이고
  스스로 다음 차례로 가지 않는다. 더 새 차례나 단계가 오면 말하던 음성이나 듣던 답변을 멈춘다.
- ASKING: 그 차례 답변자의 마이크만 구독하고 질문을 말한다.
  화면 질문 메시지는 방에 있는 지원자 모두에게 보낸다.
  question.started는 첫 소리를 보낼 때, question.spoken은 음성이 끝나거나 실패할 때 보낸다.
  같은 차례(sessionId · seq)가 다시 오면(답변 중 나갔다 돌아온 사람) 처음부터 다시 말한다.
  호명(CALL)이면 음성만 호명 문구이고, 글 · 채점 기준은 그 공통 질문이다.
- ANSWERING(화상): 7초 침묵 · [답변 완료] · 마감(deadlineAt) 중 먼저 오는 것으로 답변을 끝낸다.
  마감에는 말한 게 있을 때만 TIME_LIMIT으로 내고, 없으면 내지 않는다(BE가 닫는다).
  60초 무응답 안내는 보내지 않는다.
  자막 · 답변 상태 · 인상 점수는 답변자에게만, 리액션은 모두에게 보낸다.
  리액션의 태도는 사람마다 이어진다.
- 채팅: 답변은 듣지 않는다(BE가 확정한다). ASKING부터 DECIDING · 다음 차례 전까지
  지금 답변자가 지금 질문으로 보낸 chat.input만 받아 마지막 문장으로 리액션을 판단한다.
- DECIDING: 최종 답변(화상은 보낸 answer.completed의 글, 채팅은 BE가 보낸 group.answer의 글)으로
  꼬리질문이 필요한지 한 번만 판단해 followup.decided를 보낸다. 판단하지 못하면 필요 없음을 보낸다.
  만든 꼬리질문은 그 사람의 FOLLOWUP 차례에 말하고, 다른 차례가 오면 버린다.
- 질문 음성은 차례가 오는 순서대로 미리 하나씩 합성한다.
  BE는 차례를 정하고 20초 안에 질문이 시작되지 않으면 AI 정체로 본다.
- 오리 면접관은 답변 뒤 1초 기다렸다가 칭찬하고, 다음 질문은 칭찬이 끝난 뒤 말한다.
  화상은 답변을 전달한 뒤, 채팅은 DECIDING이 오면(BE가 최종 답변을 저장했다는 뜻) 칭찬한다.
  그 사람이 마지막 질문을 마쳤으면 칭찬하지 않는다(6.2).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable, Coroutine, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from livekit import rtc

from app.agent.answer_capture import CapturedAnswer
from app.agent.answer_rpc import (
    ANSWER_STATE_METHOD,
    AnswerState,
    InvalidAnswerSubmitError,
    answer_state_payload,
    answer_submit_reply,
    parse_answer_submit,
)
from app.agent.assignment import AssignedQuestion, GroupAssignment
from app.agent.followup import FollowupError
from app.agent.group_room import (
    GROUP_ENDED,
    PARTICIPANT_DONE,
    PARTICIPANT_ENDED,
    Announce,
    GroupPhase,
    RoomInfo,
    RoomInfoTracker,
    Turn,
    TurnKind,
)
from app.agent.interview import NEXT_QUESTION_DELAYS, CaptureSession, FinishedAnswer
from app.agent.question import QUESTION_METHOD, SpeechState, play, question_payload
from app.agent.reaction import (
    InvalidChatInputError,
    ReactionStream,
    chat_input_reply,
    parse_chat_input,
)
from app.agent.stt import SttState
from app.agent.tts import ElevenLabsTTS, SpeechAudio, TtsError
from app.common.results import KST, ResultPublishError
from app.common.session import (
    GROUP_MAX_SEQ,
    MIN_SEQ,
    InterviewMode,
    Persona,
    group_candidate,
)
from app.interview.realtime.answer_end import (
    INITIAL_STATE,
    AnswerEndEvent,
    AnswerEndState,
    AnswerStarted,
    Decision,
    Phase,
    Reconnected,
    Reconnecting,
    Speech,
    SttError,
    SubmitFailed,
    SubmitRequested,
    Tick,
    next_answer_end,
    next_deadline,
)
from app.interview.realtime.praise import Praise, choose_praise
from app.interview.realtime.progress import (
    EndReason,
    ProgressMessage,
    SpeechResult,
    followup_decided,
    group_question_started,
    question_spoken,
)
from app.interview.realtime.sentence import Sentence, last_sentence

log = logging.getLogger(__name__)
# AI 명세 6.7: 같은 공통 질문의 다음 답변자를 부를 때 말하는 문구(면접관 공통)
CALL_PHRASE = "다음 지원자분, 같은 질문에 답변해 주세요."
# AI 명세 6.5: 재시도 후에도 전송하지 못한 question.started를 다시 전송하는 간격(초)
STARTED_RETRY_SECONDS = 4.0
# AI 명세 6.7: BE가 채팅 최종 답변을 에이전트에게 보내는 SendData 주제
GROUP_ANSWER_TOPIC = "group.answer"
# 판단 단계에서 최종 답변 도착과 판단을 기다리는 시간(초, 임시 값).
# BE는 판단 단계 시작부터 7초 안에 온 판단만 쓰므로 결과 전송 여유 1초를 남긴다(AI 명세 6.7)
DECISION_SECONDS = 6.0
# 오리 칭찬 전에 BE가 그 차례를 넘기기(다음 차례 · 꼬리질문 차례 · 종료)를 기다리는
# 상한(초, 임시 값). 마지막 질문인지는 꼬리질문 판단 뒤에야 정해진다.
# BE 판단 기한 7초에 여유를 더한다
TURN_PASS_SECONDS = 10.0
# AI 명세 6.7: 지금 답변자가 아니거나 지금 질문이 아닌 [답변 완료]의 응답
NOT_ACCEPTED = json.dumps({"accepted": False}, separators=(",", ":"))


class GroupVoice(Protocol):
    """면접관 음성 합성과 송출이다."""

    async def prepare(self, text: str) -> SpeechAudio | None: ...

    async def play(self, audio: SpeechAudio, on_start: Callable[[], None]) -> None: ...

    async def say(self, audio: SpeechAudio) -> None: ...


class GroupFollowupJudge(Protocol):
    """그룹 면접 꼬리질문 판단기다. 필요 없으면 None, 판단하지 못하면 FollowupError다."""

    async def judge(
        self, persona: Persona, question: AssignedQuestion, answer: str
    ) -> AssignedQuestion | None: ...


Sender = Callable[[str, str, str], Coroutine[Any, Any, None]]
GroupCaptureOpener = Callable[
    [
        str,
        int,
        Callable[[], None],
        Callable[[Sentence, str], None],
        Callable[[SttState], None],
    ],
    CaptureSession,
]
# 면접 id · 끝낸 답변 · turnVersion · 답변을 끝낸 시각으로 answer.completed를 전달한다.
# 전달하면 True, 저장할 수 없는 답변이라 전달하지 않았으면 False다
GroupDeliver = Callable[[int, FinishedAnswer, int, datetime], Awaitable[bool]]


def per_participant(
    make: Callable[[int], ReactionStream | None],
) -> Callable[[int], ReactionStream | None]:
    """면접 id마다 리액션 판단을 하나 만들어 계속 쓴다.

    태도는 그 사람 면접 전체에 대한 값이고,
    같은 질문의 리액션 순번은 이어서 늘기 때문이다(AI 명세 6.4 · 6.5).
    """
    streams: dict[int, ReactionStream | None] = {}

    def get(session_id: int) -> ReactionStream | None:
        if session_id not in streams:
            streams[session_id] = make(session_id)
        return streams[session_id]

    return get


def _monotonic_ms() -> int:
    return int(time.monotonic() * 1000)


def _now() -> datetime:
    return datetime.now(KST)


class RoomVoice:
    """ElevenLabs로 합성하고 면접관 음성 트랙으로 송출한다."""

    def __init__(self, tts: ElevenLabsTTS, source: rtc.AudioSource, persona: Persona) -> None:
        self._tts = tts
        self._source = source
        self._persona = persona

    async def prepare(self, text: str) -> SpeechAudio | None:
        try:
            return await self._tts.synthesize(text, self._persona)
        except TtsError as e:
            log.warning("그룹 면접 음성 합성 실패: %s", e)
            return None

    async def play(self, audio: SpeechAudio, on_start: Callable[[], None]) -> None:
        await play(self._source, audio, on_start=on_start)

    async def say(self, audio: SpeechAudio) -> None:
        try:
            await play(self._source, audio)
        except Exception:
            log.exception("칭찬 음성 송출 실패")

    async def aclose(self) -> None:
        self._source.clear_queue()
        await self._source.aclose()


@dataclass
class _Answering:
    """지금 듣고 있는 화상 답변."""

    session_id: int
    seq: int
    identity: str
    state: AnswerEndState = INITIAL_STATE
    finish: EndReason | None = None
    capture: CaptureSession | None = None
    wake: asyncio.Event = field(default_factory=asyncio.Event)


@dataclass
class _ChatTurn:
    """지금 리액션을 판단하는 채팅 차례."""

    session_id: int
    seq: int
    identity: str
    reactions: ReactionStream
    # 이 차례에서 받은 마지막 채팅 입력 순번(AI 명세 6.3)
    input_seq: int = 0


class GroupInterviewRunner:
    def __init__(
        self,
        assignment: GroupAssignment,
        voice: GroupVoice,
        send: Sender,
        publish: Callable[[ProgressMessage], Awaitable[None]],
        open_capture: GroupCaptureOpener,
        deliver: GroupDeliver,
        tracker: RoomInfoTracker,
        *,
        subscribe: Callable[[int], None] = lambda _session_id: None,
        reactions: Callable[[int], ReactionStream | None] = lambda _session_id: None,
        praises: Mapping[Praise, SpeechAudio] | None = None,
        followups: GroupFollowupJudge | None = None,
        monotonic_ms: Callable[[], int] = _monotonic_ms,
        clock: Callable[[], datetime] = _now,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        """send(받는 사람 참가자 이름, RPC 메서드, 본문)로 면접방 메시지를 보낸다.

        publish는 그룹 결과 큐로 결과 메시지를 보내고, 재시도까지 실패하면 ResultPublishError다.
        subscribe(면접 id)는 그 사람 마이크만 구독하게 한다.
        reactions(면접 id)는 그 사람의 리액션 판단이다.
        tracker는 방 정보 추적기이며 답변 마감을 에이전트 시계로 옮기는 데 쓴다.
        praises는 오리 면접관의 칭찬 음성이며, None이면 칭찬하지 않는다.
        followups는 꼬리질문 판단기이며, None이면 판단 단계마다 필요 없음을 보낸다.
        """
        self._assignment = assignment
        self._video = assignment.mode is InterviewMode.VIDEO
        self._voice = voice
        self._send = send
        self._publish = publish
        self._open_capture = open_capture
        self._deliver = deliver
        self._subscribe = subscribe
        self._reactions = reactions
        self._praises = praises
        self._followups = followups
        self._ms = monotonic_ms
        self._clock = clock
        self._sleep = sleep
        self._identities = {p.identity for p in assignment.participants}
        self._tracker = tracker
        self._info: RoomInfo | None = None
        self._changed = asyncio.Event()
        # 방 정보가 바뀔 때마다 켠다. 칭찬이 차례가 넘어가기를 기다리는 데 쓴다
        self._info_event = asyncio.Event()
        self._present: set[str] = set()
        self._presence = asyncio.Event()
        # 질문 글 → 음성 합성
        self._audio: dict[str, asyncio.Task[SpeechAudio | None]] = {}
        self._last_synthesis: asyncio.Task[SpeechAudio | None] | None = None
        # 질문 음성과 칭찬 음성이 겹치지 않게 한다
        self._voice_lock = asyncio.Lock()
        self._work: asyncio.Task[None] | None = None
        # 지금 하는 일: (종류, 면접 id, seq, 시작한 turnVersion)
        self._work_key: tuple[str, int, int, int] | None = None
        self._answering: _Answering | None = None
        self._chat: _ChatTurn | None = None
        # (면접 id, seq) → 실제로 출제한 질문. 리액션 판단 입력이다
        self._asked: dict[tuple[int, int], AssignedQuestion] = {}
        self._decided: set[tuple[int, int]] = set()
        # (면접 id, seq) → 최종 답변 글. 꼬리질문 판단 재료다
        self._answers: dict[tuple[int, int], str] = {}
        self._answer_arrived = asyncio.Event()
        # (면접 id, seq) → 보낸 판단. 같은 답변 글을 다시 받으면 다시 보낸다
        self._decisions: dict[tuple[int, int], ProgressMessage] = {}
        # 면접 id → 그 사람의 FOLLOWUP 차례에 말할 꼬리질문
        self._held: dict[int, AssignedQuestion] = {}
        self._background: set[asyncio.Task[Any]] = set()
        self._subscribed: int | None = None

    @property
    def subscribed_identity(self) -> str | None:
        """마이크를 구독할 지원자다. 그 차례가 오기 전이면 None이다."""
        return None if self._subscribed is None else group_candidate(self._subscribed)

    @property
    def answering_identity(self) -> str | None:
        """지금 답변을 듣고 있는 지원자다. 인상 판단은 이 사람 사진만 한다."""
        answering = self._answering
        return None if answering is None or answering.capture is None else answering.identity

    def question(self, session_id: int, seq: int) -> str:
        return self._issued(session_id, seq).content

    def criteria(self, session_id: int, seq: int) -> str:
        return self._issued(session_id, seq).criteria

    def _issued(self, session_id: int, seq: int) -> AssignedQuestion:
        return self._asked.get((session_id, seq), AssignedQuestion("", ""))

    def room_info_changed(self, info: RoomInfo) -> None:
        """더 새 방 정보를 받았다."""
        self._info = info
        self._changed.set()
        self._info_event.set()
        answering = self._answering
        if answering is not None:
            # 마감 연장 · 단계 변경을 답변 대기에 반영한다
            answering.wake.set()

    def candidate_joined(self, identity: str) -> None:
        if identity not in self._identities:
            return
        self._present.add(identity)
        self._presence.set()
        chat = self._chat
        if chat is not None and chat.identity == identity:
            # 새로 연결한 화면은 이전 입력 순번을 모르므로 처음부터 받는다(AI 명세 6.5)
            chat.input_seq = 0
        answering = self._answering
        if answering is None or answering.identity != identity:
            return
        answering.wake.set()
        # 새로 연결한 화면은 실패 상태를 모르므로 다시 알린다(AI 명세 6.5)
        if answering.state.phase is Phase.SUBMIT_FAILED:
            self._notify(answering, AnswerState.SUBMIT_FAILED)

    def candidate_left(self, identity: str) -> None:
        self._present.discard(identity)
        self._presence.set()
        answering = self._answering
        if answering is not None and answering.identity == identity:
            answering.wake.set()

    def submit_requested(self, caller: str, payload: str) -> str:
        """[답변 완료] 처리 함수다. 지금 답변자가 지금 질문으로 보낸 것만 받는다(AI 명세 6.7)."""
        info = self._info
        turn = None if info is None else info.turn
        if turn is None or caller != group_candidate(turn.session_id):
            return NOT_ACCEPTED
        try:
            message = parse_answer_submit(payload, turn.session_id, max_seq=GROUP_MAX_SEQ)
        except InvalidAnswerSubmitError:
            return NOT_ACCEPTED
        if message.seq != turn.seq:
            return NOT_ACCEPTED
        answering = self._answering
        if (
            not self._video
            or answering is None
            or (answering.session_id, answering.seq) != (turn.session_id, turn.seq)
        ):
            return answer_submit_reply(Decision.NOT_ANSWERING)
        decision = self._apply(answering, SubmitRequested())
        if decision is Decision.ACCEPT and answering.finish is None:
            answering.finish = EndReason.MANUAL_SUBMIT
        answering.wake.set()
        return answer_submit_reply(decision)

    def chat_input_received(self, caller: str, payload: str) -> str:
        """채팅 입력(chat.input) 처리 함수다.

        보낸 사람의 면접 id가 메시지의 sessionId와 같고 그 면접 · 질문 순서가 지금 차례이며,
        그 차례에서 받은 순번보다 클 때만 판단한다. 아니면 false다(AI 명세 6.3 · 6.7).
        """
        chat = self._chat
        if chat is None or caller != chat.identity:
            return chat_input_reply(False)
        try:
            message = parse_chat_input(payload, chat.session_id, max_seq=GROUP_MAX_SEQ)
        except InvalidChatInputError:
            return chat_input_reply(False)
        if message.question_seq != chat.seq or message.seq <= chat.input_seq:
            return chat_input_reply(False)
        chat.input_seq = message.seq
        # 채팅은 입력 칸 전체가 지금까지의 답변이고,
        # 반응 여부는 마지막 문장으로 판단한다(AI 명세 6.4)
        chat.reactions.submit(last_sentence(message.text), message.pause_ms, message.text)
        return chat_input_reply(True)

    def group_answer_received(self, payload: str) -> None:
        """BE가 보낸 채팅 최종 답변(group.answer)이다(AI 명세 6.7).

        같은 질문은 처음 글만 쓰고, 다시 받으면 처음 판단을 다시 보낸다.
        """
        try:
            message = json.loads(payload)
        except ValueError:
            message = None
        if not isinstance(message, dict):
            log.error("group.answer를 읽지 못해 버린다")
            return
        session_id = message.get("sessionId")
        seq = message.get("seq")
        content = message.get("content")
        if (
            type(session_id) is not int
            or type(seq) is not int
            or not MIN_SEQ <= seq <= GROUP_MAX_SEQ
            or not isinstance(content, str)
            or not content.strip()
        ):
            log.error("group.answer 형식이 틀려 버린다")
            return
        key = (session_id, seq)
        if key in self._answers:
            decision = self._decisions.get(key)
            if decision is not None:
                self._spawn(self._publish_decision(decision))
            return
        self._answers[key] = content
        self._answer_arrived.set()

    async def run(self) -> None:
        """그룹이 끝날 때(groupStatus ENDED)까지 방 정보를 따라 진행한다."""
        self._prepare_all()
        try:
            while True:
                await self._changed.wait()
                self._changed.clear()
                info = self._info
                if info is None:
                    continue
                if info.group_status == GROUP_ENDED:
                    log.info("그룹 면접이 끝났다", extra={"group": self._assignment.group_id})
                    return
                await self._follow(info)
        finally:
            await self._stop_work()
            await self._stop_chat()
            pending = [*self._background, *self._audio.values()]
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)

    async def _follow(self, info: RoomInfo) -> None:
        turn, phase = info.turn, info.phase
        if not self._video:
            await self._follow_chat(turn, phase)
        if turn is None or phase is None:
            await self._stop_work()
            return
        if phase in (GroupPhase.ASKING, GroupPhase.SPEAKING, GroupPhase.ANSWERING):
            self._subscribe_to(turn.session_id)
        key = self._work_key
        same_turn = key is not None and key[1:3] == (turn.session_id, turn.seq)
        if phase is GroupPhase.ASKING:
            # 만든 꼬리질문은 그 사람의 FOLLOWUP 차례가 아닌 차례가 오면 버린다(AI 명세 6.7)
            followup = self._held.get(turn.session_id) if turn.kind is TurnKind.FOLLOWUP else None
            self._held = {} if followup is None else {turn.session_id: followup}
            # 같은 차례라도 ASKING이 다시 오면(이탈 뒤 다시 묻기) 처음부터 다시 말한다
            if not (
                same_turn and key is not None and key[0] == "ask" and key[3] == info.turn_version
            ):
                await self._start("ask", turn, info, self._ask(turn))
        elif phase is GroupPhase.SPEAKING:
            if not (same_turn and key is not None and key[0] == "ask"):
                await self._stop_work()
        elif phase is GroupPhase.ANSWERING:
            if not (same_turn and key is not None and key[0] == "answer"):
                if self._video:
                    await self._start("answer", turn, info, self._answer(turn))
                else:
                    await self._stop_work()
        elif phase is GroupPhase.DECIDING:
            # 화상은 BE가 답변을 저장해야 DECIDING이 오므로 답변 작업에는 마무리(판단 재료 저장 ·
            # submitted · 칭찬)만 남았다. 끊으면 판단 재료가 없어지므로 끝나게 둔다
            if not (same_turn and key is not None and key[0] == "answer"):
                await self._stop_work()
            self._decide(turn, info)
        else:
            await self._stop_work()

    async def _follow_chat(self, turn: Turn | None, phase: GroupPhase | None) -> None:
        """채팅 차례의 리액션을 ASKING에서 시작하고 DECIDING · 다음 차례에서 멈춘다."""
        chat = self._chat
        same = (
            chat is not None
            and turn is not None
            and (chat.session_id, chat.seq) == (turn.session_id, turn.seq)
        )
        if same and phase in (GroupPhase.SPEAKING, GroupPhase.ANSWERING):
            return
        stopped = await self._stop_chat()
        if turn is None:
            return
        if phase is GroupPhase.ASKING:
            reactions = self._reactions(turn.session_id)
            identity = group_candidate(turn.session_id)
            if reactions is not None:
                # 질문 음성 재생 중의 입력도 지금 질문의 입력이다(개인 면접과 같다)
                reactions.start(turn.seq, identity)
                self._chat = _ChatTurn(turn.session_id, turn.seq, identity, reactions)
        elif phase is GroupPhase.DECIDING and (turn.session_id, turn.seq) not in self._decided:
            # 채팅은 DECIDING이 와야 최종 답변이 저장된 것을 안다.
            # 판단(followup.decided)을 보내기 전에 칭찬을 잡아 둬 다음 질문보다 먼저 말한다
            reactions = stopped.reactions if same and stopped is not None else None
            self._schedule_praise(turn, reactions)

    async def _stop_chat(self) -> _ChatTurn | None:
        chat, self._chat = self._chat, None
        if chat is not None:
            await chat.reactions.stop()
        return chat

    async def _start(
        self, kind: str, turn: Turn, info: RoomInfo, work: Coroutine[Any, Any, None]
    ) -> None:
        await self._stop_work()
        self._work_key = (kind, turn.session_id, turn.seq, info.turn_version)
        self._work = asyncio.create_task(work)

    async def _stop_work(self) -> None:
        work, self._work, self._work_key = self._work, None, None
        if work is not None:
            work.cancel()
            await asyncio.gather(work, return_exceptions=True)

    def _subscribe_to(self, session_id: int) -> None:
        if self._video and self._subscribed != session_id:
            self._subscribed = session_id
            self._subscribe(session_id)

    def _prepare_all(self) -> None:
        """차례가 오는 순서대로 하나씩 합성한다(ElevenLabs 동시 요청을 하나로 둔다)."""
        common = self._assignment.common_questions
        people = self._assignment.participants
        texts = [
            common[0].content,
            CALL_PHRASE,
            *(p.personal_questions[0].content for p in people),
            common[1].content,
            *(p.personal_questions[1].content for p in people),
        ]
        for text in texts:
            self._synthesis(text)

    def _synthesis(self, text: str) -> asyncio.Task[SpeechAudio | None]:
        task = self._audio.get(text)
        if task is None:
            task = asyncio.create_task(self._synthesize_after(self._last_synthesis, text))
            self._audio[text] = task
            self._last_synthesis = task
        return task

    async def _synthesize_after(
        self, previous: asyncio.Task[SpeechAudio | None] | None, text: str
    ) -> SpeechAudio | None:
        if previous is not None:
            await asyncio.wait((previous,))
        return await self._voice.prepare(text)

    def _question_of(self, turn: Turn) -> AssignedQuestion | None:
        index = turn.base_index
        if turn.kind is TurnKind.COMMON and index in (1, 3):
            return self._assignment.common_questions[(index - 1) // 2]
        participant = self._assignment.participant(turn.session_id)
        if turn.kind is TurnKind.PERSONAL and index in (2, 4) and participant is not None:
            return participant.personal_questions[(index - 2) // 2]
        if turn.kind is TurnKind.FOLLOWUP:
            return self._held.get(turn.session_id)
        return None

    async def _ask(self, turn: Turn) -> None:
        question = self._question_of(turn)
        if question is None:
            log.error(
                "말할 질문이 없다 kind=%s baseIndex=%s",
                turn.kind,
                turn.base_index,
                extra={"session": turn.session_id, "seq": turn.seq},
            )
            return
        self._asked[(turn.session_id, turn.seq)] = question
        spoken_text = CALL_PHRASE if turn.announce is Announce.CALL else question.content
        audio = await asyncio.shield(self._synthesis(spoken_text))
        async with self._voice_lock:
            started: asyncio.Task[None] | None = None

            def mark_started() -> None:
                nonlocal started
                if started is None:
                    speech_ms = 0 if audio is None else audio.duration_ms
                    started = self._spawn(
                        self._send_started(turn, question, self._clock(), speech_ms)
                    )

            if audio is None:
                mark_started()
                result = SpeechResult.FAILED
            else:
                await self._broadcast_question(turn, question, SpeechState.STARTED, audio)
                try:
                    await self._voice.play(audio, mark_started)
                    result = SpeechResult.ENDED
                except Exception:
                    log.exception("질문 음성 송출 실패", extra={"seq": turn.seq})
                    result = SpeechResult.FAILED
            # 화면에 ended · failed를 보내는 시각이 question.spoken의 endedAt이다
            # (BE 그룹 면접 설계 6.4)
            ended_at = self._clock()
            speech = SpeechState.ENDED if result is SpeechResult.ENDED else SpeechState.FAILED
            await self._broadcast_question(turn, question, speech)
            self._spawn(self._send_spoken(turn, started, ended_at, result))

    async def _broadcast_question(
        self,
        turn: Turn,
        question: AssignedQuestion,
        speech: SpeechState,
        audio: SpeechAudio | None = None,
    ) -> None:
        payload = question_payload(turn.session_id, turn.seq, question.content, speech, audio)
        await asyncio.gather(
            *(self._send(identity, QUESTION_METHOD, payload) for identity in sorted(self._present))
        )

    async def _send_started(
        self, turn: Turn, question: AssignedQuestion, started_at: datetime, speech_ms: int
    ) -> None:
        """question.started를 보낸다. 실패하면 그 차례 동안 다시 보낸다(AI 명세 6.5)."""
        while True:
            message = group_question_started(
                turn.session_id,
                turn.seq,
                started_at,
                question.content,
                question.criteria,
                turn_version=self._version(),
                kind=turn.kind.value,
                speech_ms=speech_ms,
                prompt_version=question.prompt_version,
                model_version=question.model_version,
            )
            try:
                await self._publish(message)
                return
            except ResultPublishError:
                log.error("question.started 전송 실패", extra={"seq": turn.seq})
            await self._sleep(STARTED_RETRY_SECONDS)
            if not self._is_turn(turn):
                return

    async def _send_spoken(
        self,
        turn: Turn,
        started: asyncio.Task[None] | None,
        ended_at: datetime,
        speech: SpeechResult,
    ) -> None:
        # BE는 question.started를 받은 뒤(SPEAKING)에만 이 메시지를 받으므로 그 전송을 기다린다.
        # 기다리는 동안 다음 질문 · 칭찬 음성을 막지 않도록 음성 잠금 밖에서 따로 실행한다
        if started is not None:
            await asyncio.wait((started,))
        message = question_spoken(
            turn.session_id,
            turn.seq,
            turn_version=self._version(),
            ended_at=ended_at,
            speech=speech,
        )
        try:
            await self._publish(message)
        except ResultPublishError:
            # 오지 않으면 BE가 음성 길이 + 5초 뒤 스스로 답변 시간을 시작한다(AI 명세 6.7)
            log.error("question.spoken 전송 실패", extra={"seq": turn.seq})

    async def _answer(self, turn: Turn) -> None:
        try:
            await self._listen(turn)
        finally:
            self._answering = None

    async def _listen(self, turn: Turn) -> None:
        identity = group_candidate(turn.session_id)
        # 시작 직후에는 아직 들어오는 중일 수 있다. 그 사이 차례가 바뀌면 이 작업이 취소된다
        while identity not in self._present:
            self._presence.clear()
            await self._presence.wait()
        answering = _Answering(turn.session_id, turn.seq, identity)
        self._answering = answering
        self._apply(answering, AnswerStarted(self._ms(), InterviewMode.VIDEO))
        reactions = self._reactions(turn.session_id)
        if reactions is not None:
            reactions.start(turn.seq, identity)
        session = self._open_capture(
            identity,
            turn.session_id,
            lambda: self._speech(answering, reactions),
            lambda sentence, answer: self._sentence(reactions, sentence, answer),
            lambda state: self._stt_state(answering, state),
        )
        answering.capture = session
        capturing = asyncio.create_task(session.run())
        collected: CapturedAnswer | None = None
        ended_at: datetime | None = None
        try:
            while answering.finish is None:
                if identity not in self._present:
                    # 답변 중 퇴장하면 그 답변을 버린다(AI 명세 6.5 · 6.7)
                    return
                if capturing.done():
                    self._stt_failed(answering, capturing, session)
                    break
                deadline = self._deadline_ms(turn)
                if deadline is not None and self._ms() >= deadline:
                    if not self._time_limit(answering):
                        return
                    break
                await self._wait(answering, capturing, deadline)
                step_deadline = next_deadline(answering.state)
                if step_deadline is not None and self._ms() >= step_deadline:
                    self._tick(answering)
            ended_at = self._clock()
            session.stop()
            collected = await self._collect(capturing, session)
        finally:
            if collected is None:
                session.stop()
                capturing.cancel()
                await asyncio.gather(capturing, return_exceptions=True)
            answering.capture = None
            if reactions is not None:
                await reactions.stop()
            await session.aclose()
        assert answering.finish is not None and ended_at is not None
        finished = FinishedAnswer(turn.seq, collected, answering.finish)
        if await self._deliver_until_saved(answering, finished, ended_at):
            # 보낸 답변 글이 꼬리질문 판단 재료다(AI 명세 6.7)
            self._answers[(turn.session_id, turn.seq)] = collected.content
            self._answer_arrived.set()
            self._notify(answering, AnswerState.SUBMITTED)
            self._schedule_praise(turn, reactions)

    def _time_limit(self, answering: _Answering) -> bool:
        """마감이다. 말한 게 있어 TIME_LIMIT으로 내면 True, 낼 게 없으면 False다."""
        decision = self._apply(answering, SubmitRequested())
        if decision is not Decision.ACCEPT:
            return False
        answering.finish = EndReason.TIME_LIMIT
        self._notify(answering, AnswerState.AUTO_SUBMITTED)
        return True

    def _deadline_ms(self, turn: Turn) -> int | None:
        """지금 차례의 답변 마감을 에이전트의 단조 시계(밀리초)로 옮긴다. 연장하면 바뀐다."""
        info = self._info
        current = None if info is None else info.turn
        if current is None or current.deadline_at is None:
            return None
        if (current.session_id, current.seq) != (turn.session_id, turn.seq):
            return None
        remaining = self._tracker.local(current.deadline_at) - self._clock()
        return self._ms() + int(remaining.total_seconds() * 1000)

    async def _wait(
        self,
        answering: _Answering,
        capturing: asyncio.Task[CapturedAnswer],
        deadline: int | None,
    ) -> None:
        candidates = [d for d in (next_deadline(answering.state), deadline) if d is not None]
        timeout = None if not candidates else max(0, min(candidates) - self._ms()) / 1000
        answering.wake.clear()
        waking = asyncio.create_task(answering.wake.wait())
        try:
            await asyncio.wait(
                (waking, capturing), timeout=timeout, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            waking.cancel()
            await asyncio.gather(waking, return_exceptions=True)

    def _tick(self, answering: _Answering) -> None:
        # 60초 무응답(TIMEOUT)은 답변 시간이 대신하므로 알리지 않는다(AI 명세 6.7)
        if self._apply(answering, Tick(self._ms())) is Decision.SUBMIT:
            answering.finish = EndReason.AUTO_SUBMIT
            self._notify(answering, AnswerState.AUTO_SUBMITTED)

    def _stt_failed(
        self,
        answering: _Answering,
        capturing: asyncio.Task[CapturedAnswer],
        session: CaptureSession,
    ) -> None:
        error = capturing.exception() if not capturing.cancelled() else None
        log.error("답변 음성 인식 실패: %r", error, extra={"seq": answering.seq}, exc_info=error)
        self._apply(answering, SttError())
        session.fail()
        self._notify(answering, AnswerState.STT_FAILED)
        # 발화가 있었으면 그때까지 인식된 글로 낸다.
        # 없으면 전달할 때 빈 글이라 보내지 않는다(AI 명세 6.5)
        self._apply(answering, SubmitRequested())
        answering.finish = EndReason.STT_FAILED

    async def _collect(
        self, capturing: asyncio.Task[CapturedAnswer], session: CaptureSession
    ) -> CapturedAnswer:
        try:
            return await capturing
        except Exception:
            return session.snapshot()

    async def _deliver_until_saved(
        self, answering: _Answering, finished: FinishedAnswer, ended_at: datetime
    ) -> bool:
        """전달하지 못하면 submitFailed를 알리고 [다시 시도]를 기다린다(AI 명세 6.5).

        차례가 끝나면 취소된다.
        """
        while True:
            try:
                return await self._deliver(
                    answering.session_id, finished, self._version(), ended_at
                )
            except ResultPublishError as e:
                log.error("답변 전달 실패: %s", e, extra={"seq": answering.seq})
                self._apply(answering, SubmitFailed())
                self._notify(answering, AnswerState.SUBMIT_FAILED)
                while answering.state.phase is Phase.SUBMIT_FAILED:
                    answering.wake.clear()
                    await answering.wake.wait()

    def _speech(self, answering: _Answering, reactions: ReactionStream | None) -> None:
        self._apply(answering, Speech(self._ms()))
        answering.wake.set()
        if reactions is not None and answering.capture is not None:
            reactions.speaking(answering.capture.answer_tokens())

    @staticmethod
    def _sentence(reactions: ReactionStream | None, sentence: Sentence, answer: str) -> None:
        if reactions is not None:
            reactions.submit(sentence.text, sentence.pause_ms, answer)

    def _stt_state(self, answering: _Answering, state: SttState) -> None:
        if state is SttState.RECONNECTING:
            self._apply(answering, Reconnecting())
            self._notify(answering, AnswerState.STT_RECONNECTING)
        else:
            self._apply(answering, Reconnected(self._ms()))
        answering.wake.set()

    def _apply(self, answering: _Answering, event: AnswerEndEvent) -> Decision:
        step = next_answer_end(answering.state, event)
        answering.state = step.state
        return step.decision

    def _notify(self, answering: _Answering, state: AnswerState) -> None:
        payload = answer_state_payload(answering.session_id, answering.seq, state)
        self._spawn(self._send(answering.identity, ANSWER_STATE_METHOD, payload))

    def _schedule_praise(self, turn: Turn, reactions: ReactionStream | None) -> None:
        delay = NEXT_QUESTION_DELAYS.get(self._assignment.persona, 0.0)
        if self._praises is None or not delay:
            return
        # 답변 중에 받은 마지막 판단으로 고른다(AI 명세 6.2)
        praise = choose_praise(None if reactions is None else reactions.last_judgment)
        self._spawn(self._praise(turn, praise, self._praises.get(praise), delay))

    async def _praise(
        self, turn: Turn, praise: Praise, audio: SpeechAudio | None, delay: float
    ) -> None:
        # 다음 질문이 칭찬보다 먼저 나가지 않도록 기다리는 동안에도 음성을 잡아 둔다
        async with self._voice_lock:
            await self._sleep(delay)
            # 마지막 질문인지는 꼬리질문 판단 뒤 BE가 그 차례를 넘겨야 안다
            try:
                async with asyncio.timeout(TURN_PASS_SECONDS):
                    while self._is_turn(turn):
                        self._info_event.clear()
                        await self._info_event.wait()
            except TimeoutError:
                log.warning("차례가 넘어가지 않아 기다리지 않고 칭찬한다", extra={"seq": turn.seq})
            info = self._info
            state = None if info is None else info.participant_state(turn.session_id)
            # 마지막 질문을 마친 사람은 면접 끝내기(5.8)로 넘어가므로 칭찬하지 않는다(AI 명세 6.2)
            if state in (PARTICIPANT_DONE, PARTICIPANT_ENDED):
                return
            log.info("칭찬 praise=%s", praise.value)
            if audio is not None:
                await self._voice.say(audio)

    def _decide(self, turn: Turn, info: RoomInfo) -> None:
        # 같은 질문은 한 번만 판단한다(AI 명세 6.7)
        key = (turn.session_id, turn.seq)
        if key in self._decided:
            return
        self._decided.add(key)
        self._spawn(self._judge(turn))

    async def _judge(self, turn: Turn) -> None:
        """최종 답변으로 꼬리질문을 판단해 보낸다. 판단하지 못하면 필요 없음을 바로 보낸다.

        BE는 늦은 판단을 쓰지 않으므로 기다리지 말고 보낸다(AI 명세 6.7).
        """
        key = (turn.session_id, turn.seq)
        received_at = self._clock()
        followup: AssignedQuestion | None = None
        generation_ms: int | None = None
        question = self._asked.get(key)
        try:
            # 판단기가 없거나(GMS 설정 없음) 직전 질문을 모르면 기다리지 않고 필요 없음을 보낸다
            if self._followups is not None and question is not None:
                async with asyncio.timeout(DECISION_SECONDS):
                    answer = await self._final_answer(key)
                    started = self._ms()
                    try:
                        followup = await self._followups.judge(
                            self._assignment.persona, question, answer
                        )
                    finally:
                        generation_ms = self._ms() - started
        except (TimeoutError, FollowupError) as e:
            log.warning(
                "꼬리질문을 판단하지 못해 필요 없음으로 보낸다: %r", e, extra={"seq": turn.seq}
            )
        except Exception:
            # 판단 실패는 면접 진행에 영향을 주지 않아야 하므로
            # 예상하지 못한 오류도 필요 없음으로 보낸다
            log.exception("꼬리질문 판단 중 예상하지 못한 오류", extra={"seq": turn.seq})
        message = followup_decided(
            turn.session_id,
            turn.seq,
            turn_version=self._version(),
            received_at=received_at,
            generation_ms=generation_ms,
            content=None if followup is None else followup.content,
            criteria=None if followup is None else followup.criteria,
            prompt_version=None if followup is None else followup.prompt_version,
            model_version=None if followup is None else followup.model_version,
        )
        self._decisions[key] = message
        # 판단이 늦어 BE가 이미 다음 차례로 넘어갔으면 쓰이지 않으므로 들고 있지 않는다
        if followup is not None and self._is_turn(turn):
            self._held[turn.session_id] = followup
            # FOLLOWUP 차례가 오기 전에 음성을 미리 합성한다
            self._synthesis(followup.content)
        await self._publish_decision(message)

    async def _final_answer(self, key: tuple[int, int]) -> str:
        """그 질문의 최종 답변 글이다. 채팅은 BE가 group.answer를 보낼 때까지 기다린다."""
        while key not in self._answers:
            self._answer_arrived.clear()
            await self._answer_arrived.wait()
        return self._answers[key]

    async def _publish_decision(self, message: ProgressMessage) -> None:
        try:
            await self._publish(message)
        except ResultPublishError:
            # 늦으면 BE가 7초 뒤 꼬리질문 없이 넘어간다(AI 명세 6.7)
            log.error("followup.decided 전송 실패")

    def _version(self) -> int:
        """받은 방 정보 중 마지막 turnVersion이다(AI 명세 6.7 결과 메시지)."""
        return 0 if self._info is None else self._info.turn_version

    def _is_turn(self, turn: Turn) -> bool:
        info = self._info
        current = None if info is None else info.turn
        return current is not None and (current.session_id, current.seq) == (
            turn.session_id,
            turn.seq,
        )

    def _spawn(self, coroutine: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
        task = asyncio.create_task(coroutine)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task
