"""면접 동안 리액션을 판단해 interview.reaction으로 지원자 화면에 전송한다.

기준: AI 명세 6.2 3번, 6.3 interview.reaction, 6.4 리액션 판단, 6.5 지원자 퇴장·새로고침.
- 판단은 답변 처리와 분리해 실행한다.
  Jev가 늦어도 전사·답변 끝 판단이 멈추지 않아야 하기 때문이다.
- 판단은 동시에 진행될 수 있으므로 이미 전송한 seq 이하의 결과는 폐기한다.
  화면이 가장 큰 seq만 사용하므로 늦게 끝난 이전 판단은 전송해도 사용되지 않는다.
- 태도는 면접 동안 이 객체에 보관한다(AI 명세 6.4 「면접 동안 메모리」).
  재입장해도 유지하고, 같은 질문의 seq는 1로 되돌리지 않고 이어서 증가시킨다(AI 명세 6.5).
- 답변이 끝나거나 지원자가 퇴장하면 판단 중이던 리액션은 전송하지 않는다(AI 명세 6.5).
- 채팅은 가장 최근에 수신한 입력의 판단 결과만 적용한다(AI 명세 6.4).
  화상과 달리 입력마다 입력 칸 전체를 다시 판단하므로, 이전 입력의 결과는 지원자가 이미
  삭제하거나 수정한 글에 대한 판단일 수 있다.
- 화상은 발화 중단(interrupt)도 판단한다(AI 명세 6.4).
  질문 이탈은 Jev 판단이 끝날 때, 긴 답변은 Jev 응답을 기다리지 않고 발화가 갱신될 때 판단한다.
  문장이 끝나지 않아도 긴 답변을 판단하기 위함이다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from typing import Any, Protocol

from app.common.answer import SpeechToken
from app.common.session import MAX_SEQ, MIN_SEQ, Persona
from app.interview.realtime.interrupt import (
    Interrupt,
    InterruptReason,
    decide_interrupt,
    speaking_ms,
)
from app.interview.realtime.reaction import (
    NEUTRAL_ATTITUDE,
    Attitude,
    Judgment,
    Reaction,
    ReactionContext,
)

log = logging.getLogger(__name__)
REACTION_METHOD = "interview.reaction"
CHAT_INPUT_METHOD = "interview.chatInput"
# AI 명세 6.3: 채팅 입력 글 상한.
# 화면은 UTF-16 단위로 자르지만, 이 검사는 과도한 본문을 막는 용도이므로 글자 수로 비교한다
MAX_CHAT_INPUT_LENGTH = 1_000


class InvalidChatInputError(ValueError):
    """채팅 입력 본문 형식이 틀렸다."""


@dataclass(frozen=True)
class ChatInput:
    question_seq: int
    seq: int
    text: str
    pause_ms: float


def parse_chat_input(payload: str, session_id: int) -> ChatInput:
    """interview.chatInput 본문(AI 명세 6.3)을 해석한다.

    다른 면접의 메시지이거나 형식이 틀리면 InvalidChatInputError를 발생시킨다.
    """
    try:
        message = json.loads(payload)
    except json.JSONDecodeError as e:
        raise InvalidChatInputError("JSON이 아니다") from e
    if not isinstance(message, dict) or message.get("type") != "chat.input":
        raise InvalidChatInputError("type이 chat.input이 아니다")
    if message.get("sessionId") != session_id or isinstance(message.get("sessionId"), bool):
        raise InvalidChatInputError("다른 면접의 메시지다")
    question_seq = message.get("questionSeq")
    seq = message.get("seq")
    text = message.get("text")
    pause_ms = message.get("pauseMs")
    # bool은 int에 속하므로 true를 1로 허용하지 않도록 형식을 비교한다
    if type(question_seq) is not int or not MIN_SEQ <= question_seq <= MAX_SEQ:
        raise InvalidChatInputError(f"questionSeq는 {MIN_SEQ}~{MAX_SEQ}의 정수여야 한다")
    if type(seq) is not int or seq < 1:
        raise InvalidChatInputError("seq는 1 이상의 정수여야 한다")
    if not isinstance(text, str) or len(text) > MAX_CHAT_INPUT_LENGTH:
        raise InvalidChatInputError(f"text는 {MAX_CHAT_INPUT_LENGTH}자 이하의 문자열이어야 한다")
    if (
        not isinstance(pause_ms, int | float)
        or isinstance(pause_ms, bool)
        or not math.isfinite(pause_ms)
        or pause_ms < 0
    ):
        raise InvalidChatInputError("pauseMs는 0 이상의 숫자여야 한다")
    return ChatInput(question_seq, seq, text, float(pause_ms))


def chat_input_reply(accepted: bool) -> str:
    """판단 대상으로 수신했는지만 나타낸다.

    판단 성공 여부는 담지 않는다(AI 명세 6.3).
    """
    return json.dumps({"accepted": accepted}, separators=(",", ":"))


class Judge(Protocol):
    def judge(self, context: ReactionContext) -> Awaitable[Judgment]: ...


Sender = Callable[[str, str], Coroutine[Any, Any, None]]


def reaction_payload(
    session_id: int,
    question_seq: int,
    seq: int,
    reaction: Reaction | None,
    attitude: Attitude,
    interrupt: Interrupt | None = None,
) -> str:
    """interview.reaction 본문(AI 명세 6.3).

    키는 항상 모두 담는다.
    """
    message = {
        "type": "reaction",
        "sessionId": session_id,
        "questionSeq": question_seq,
        "seq": seq,
        "reaction": None if reaction is None else reaction.to_json(),
        "attitude": attitude.to_json(),
        "interrupt": None if interrupt is None else interrupt.to_json(),
    }
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))


class ReactionStream:
    def __init__(
        self,
        session_id: int,
        judge: Judge,
        send: Sender,
        *,
        question: Callable[[int], str],
        criteria: Callable[[int], str],
        latest_only: bool = False,
        persona: Persona | None = None,
    ) -> None:
        """persona는 발화 중단 문구의 면접관이며, None이면 발화 중단을 판단하지 않는다(채팅)."""
        self._session_id = session_id
        self._judge = judge
        self._send = send
        self._question = question
        self._criteria = criteria
        self._latest_only = latest_only
        self._persona = persona
        # 현재 답변에서 전송한 발화 중단 이유와 마지막으로 계산한 발화 시간
        self._issued: set[InterruptReason] = set()
        self._speaking: int | None = None
        # 발화 중단을 전송할 때 호출한다.
        # 면접 진행기가 안내 음성을 재생하도록 연결한다
        self.on_interrupt: Callable[[Interrupt], None] | None = None
        self.attitude = NEUTRAL_ATTITUDE
        self._question_seq: int | None = None
        self._destination: str | None = None
        self._seq = 0
        self._sent_seq = 0
        # 답변 하나를 들을 때마다 증가한다.
        # 끝난 답변의 판단 결과를 구분하기 위함이다
        self._listening: int | None = None
        self._generation = 0
        self._tasks: set[asyncio.Task[None]] = set()
        # 지금 답변에서 Jev가 판단한 마지막 결과.
        # 오리 면접관이 답변 뒤 칭찬을 선택할 때 사용한다
        self._last_judgment: Judgment | None = None

    @property
    def listening(self) -> bool:
        return self._listening is not None

    @property
    def last_judgment(self) -> Judgment | None:
        """지금 답변에서 Jev가 판단한 마지막 결과를 반환한다.

        판단한 적이 없으면 None이다.
        답변이 끝난 뒤에도 다음 답변을 듣기 시작할 때까지 유지한다.
        """
        return self._last_judgment

    def start(self, question_seq: int, destination: str) -> None:
        """답변을 듣기 시작할 때(채팅은 질문을 말하기 시작할 때) 호출한다."""
        if question_seq != self._question_seq:
            self._question_seq = question_seq
            self._seq = 0
            self._sent_seq = 0
        self._destination = destination
        # 재입장하면 답변을 처음부터 다시 들으므로 발화 중단도 새 답변 기준으로 판단한다
        self._issued.clear()
        self._speaking = None
        self._last_judgment = None
        self._generation += 1
        self._listening = self._generation

    def submit(self, text: str, pause_ms: float, answer: str) -> None:
        """판단을 시작하고 기다리지 않고 반환한다.

        답변을 듣는 중이 아니면 판단하지 않는다.
        """
        if self._listening is None or self._question_seq is None:
            return
        self._seq += 1
        context = ReactionContext(
            question=self._question(self._question_seq),
            criteria=self._criteria(self._question_seq),
            text=text,
            pause_ms=pause_ms,
            answer=answer,
            attitude=self.attitude,
        )
        task = asyncio.create_task(self._run(self._listening, self._seq, context))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def speaking(self, tokens: tuple[SpeechToken, ...] | None) -> None:
        """발화가 갱신될 때 호출한다.

        긴 답변이면 Jev 판단을 기다리지 않고 바로 전송한다.
        """
        if self._persona is None or self._listening is None:
            return
        self._speaking = speaking_ms(tokens)
        interrupt = self._interrupt(None)
        if interrupt is None:
            return
        self._seq += 1
        task = asyncio.create_task(self._emit(self._seq, Judgment(None, self.attitude), interrupt))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def stop(self) -> None:
        """답변이 끝나거나 지원자가 퇴장했을 때 호출한다.

        판단 중이던 리액션은 전송하지 않는다.
        """
        self._listening = None
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _run(self, generation: int, seq: int, context: ReactionContext) -> None:
        judgment = await self._judge.judge(context)
        # 취소 직전에 끝난 판단도 끝난 답변에 적용하지 않도록 결과를 적용하기 전에 다시 확인한다
        if self._listening != generation or seq <= self._sent_seq:
            return
        if self._latest_only and seq != self._seq:
            return
        if judgment.judged:
            self._last_judgment = judgment
        await self._emit(seq, judgment, self._interrupt(judgment.off_topic))

    def _interrupt(self, off_topic: float | None) -> Interrupt | None:
        if self._persona is None:
            return None
        interrupt = decide_interrupt(
            off_topic, self._speaking, persona=self._persona, issued=frozenset(self._issued)
        )
        if interrupt is not None:
            self._issued.add(interrupt.reason)
        return interrupt

    async def _emit(self, seq: int, judgment: Judgment, interrupt: Interrupt | None) -> None:
        self._sent_seq = seq
        if interrupt is not None and self.on_interrupt is not None:
            self.on_interrupt(interrupt)
        self.attitude = judgment.attitude
        assert self._question_seq is not None and self._destination is not None
        payload = reaction_payload(
            self._session_id,
            self._question_seq,
            seq,
            judgment.reaction,
            judgment.attitude,
            interrupt,
        )
        await self._send(self._destination, payload)
