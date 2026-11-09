import asyncio
import contextlib
import json
from typing import Any

from app.agent.reaction import (
    CHAT_INPUT_METHOD,
    REACTION_METHOD,
    ChatInput,
    ReactionStream,
    chat_input_reply,
    parse_chat_input,
    reaction_payload,
)
from app.common.answer import SpeechToken
from app.common.session import Persona
from app.interview.realtime.interrupt import MAX_SPEAKING_MS
from app.interview.realtime.reaction import (
    NEUTRAL_ATTITUDE,
    Attitude,
    Judgment,
    Reaction,
    ReactionContext,
)

SMILE = Reaction("expression", "smile", 0.4)


class FakeJudge:
    """판단마다 끝낼 시점을 시험이 정한다."""

    def __init__(self) -> None:
        self.contexts: list[ReactionContext] = []
        self.results: list[asyncio.Future[Judgment]] = []

    async def judge(self, context: ReactionContext) -> Judgment:
        self.contexts.append(context)
        result: asyncio.Future[Judgment] = asyncio.get_running_loop().create_future()
        self.results.append(result)
        return await result

    def finish(self, index: int, judgment: Judgment) -> None:
        self.results[index].set_result(judgment)


class Harness:
    def __init__(self) -> None:
        self.judge = FakeJudge()
        self.sent: list[dict[str, Any]] = []
        self.stream = ReactionStream(
            55,
            self.judge,
            self.send,
            question=lambda seq: f"질문 {seq}",
            criteria=lambda seq: f"기준 {seq}",
        )

    async def send(self, destination: str, payload: str) -> None:
        assert destination == "candidate"
        self.sent.append(json.loads(payload))

    async def settle(self) -> None:
        for _ in range(5):
            await asyncio.sleep(0)


def run(scenario: Any) -> Harness:
    async def main() -> Harness:
        harness = Harness()
        await scenario(harness)
        await harness.stream.stop()
        return harness

    return asyncio.run(main())


def test_method_name_and_payload_always_have_every_key() -> None:
    assert REACTION_METHOD == "interview.reaction"
    assert json.loads(reaction_payload(55, 2, 3, None, NEUTRAL_ATTITUDE)) == {
        "type": "reaction",
        "sessionId": 55,
        "questionSeq": 2,
        "seq": 3,
        "reaction": None,
        "attitude": {"interest": 0.5, "trust": 0.5},
        "interrupt": None,
    }


def test_sentence_is_judged_with_question_and_previous_attitude() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.start(2, "candidate")
        h.stream.submit("문장이에요.", 700.0, "앞 문장. 문장이에요.")
        await h.settle()
        h.judge.finish(0, Judgment(SMILE, Attitude(0.8, 0.6)))
        await h.settle()
        h.stream.submit("다음 문장.", 0.0, "앞 문장. 문장이에요. 다음 문장.")
        await h.settle()

    h = run(scenario)
    assert h.judge.contexts[0] == ReactionContext(
        "질문 2", "기준 2", "문장이에요.", 700.0, "앞 문장. 문장이에요.", NEUTRAL_ATTITUDE
    )
    # 다음 판단은 직전 판단의 태도로 시작한다
    assert h.judge.contexts[1].attitude == Attitude(0.8, 0.6)
    assert h.sent == [
        {
            "type": "reaction",
            "sessionId": 55,
            "questionSeq": 2,
            "seq": 1,
            "reaction": SMILE.to_json(),
            "attitude": {"interest": 0.8, "trust": 0.6},
            "interrupt": None,
        }
    ]


def test_failed_judgment_is_sent_without_reaction() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.start(1, "candidate")
        h.stream.submit("문장.", 0.0, "문장.")
        await h.settle()
        h.judge.finish(0, Judgment(None, NEUTRAL_ATTITUDE))
        await h.settle()

    h = run(scenario)
    assert [(m["seq"], m["reaction"]) for m in h.sent] == [(1, None)]


def test_older_judgment_finishing_late_is_dropped() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.start(1, "candidate")
        h.stream.submit("첫째.", 0.0, "첫째.")
        h.stream.submit("둘째.", 0.0, "첫째. 둘째.")
        await h.settle()
        h.judge.finish(1, Judgment(SMILE, Attitude(0.9, 0.9)))
        await h.settle()
        h.judge.finish(0, Judgment(None, Attitude(0.1, 0.1)))
        await h.settle()

    h = run(scenario)
    assert [m["seq"] for m in h.sent] == [2]
    assert h.stream.attitude == Attitude(0.9, 0.9)


def test_judgment_in_progress_is_not_sent_after_stop() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.start(1, "candidate")
        h.stream.submit("문장.", 0.0, "문장.")
        await h.settle()
        await h.stream.stop()
        h.stream.submit("퇴장 뒤 문장.", 0.0, "퇴장 뒤 문장.")
        await h.settle()

    h = run(scenario)
    assert h.sent == []
    assert len(h.judge.contexts) == 1
    assert h.judge.results[0].cancelled()


def test_rejoin_keeps_attitude_and_continues_seq_of_same_question() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.start(1, "candidate")
        h.stream.submit("첫째.", 0.0, "첫째.")
        await h.settle()
        h.judge.finish(0, Judgment(None, Attitude(0.7, 0.7)))
        await h.settle()
        await h.stream.stop()
        h.stream.start(1, "candidate")
        h.stream.submit("다시 첫째.", 0.0, "다시 첫째.")
        await h.settle()
        h.judge.finish(1, Judgment(None, Attitude(0.6, 0.6)))
        await h.settle()

    h = run(scenario)
    # 화면이 이전 기록을 보존해도 폐기하지 않도록 seq를 이어서 증가시킨다(AI 명세 6.5)
    assert [m["seq"] for m in h.sent] == [1, 2]
    assert h.judge.contexts[1].attitude == Attitude(0.7, 0.7)


def test_next_question_starts_seq_from_one_and_keeps_attitude() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.start(1, "candidate")
        h.stream.submit("첫째.", 0.0, "첫째.")
        await h.settle()
        h.judge.finish(0, Judgment(None, Attitude(0.7, 0.2)))
        await h.settle()
        await h.stream.stop()
        h.stream.start(2, "candidate")
        h.stream.submit("둘째 질문 답.", 0.0, "둘째 질문 답.")
        await h.settle()
        h.judge.finish(1, Judgment(None, Attitude(0.7, 0.3)))
        await h.settle()

    h = run(scenario)
    assert [(m["questionSeq"], m["seq"]) for m in h.sent] == [(1, 1), (2, 1)]
    assert h.judge.contexts[1].question == "질문 2"
    assert h.judge.contexts[1].attitude == Attitude(0.7, 0.2)


def test_nothing_is_judged_before_listening() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.submit("문장.", 0.0, "문장.")
        await h.settle()

    h = run(scenario)
    assert h.judge.contexts == []


class CancelIgnoringJudge:
    """취소 요청을 받아도 결과를 반환하는 판단기다."""

    def __init__(self) -> None:
        self.started = asyncio.Event()

    async def judge(self, context: ReactionContext) -> Judgment:
        self.started.set()
        with contextlib.suppress(asyncio.CancelledError):
            await asyncio.Event().wait()
        return Judgment(SMILE, Attitude(0.9, 0.9))


def test_result_returned_despite_cancel_is_not_applied_after_stop() -> None:
    async def main() -> list[str]:
        sent: list[str] = []

        async def send(destination: str, payload: str) -> None:
            sent.append(payload)

        judge = CancelIgnoringJudge()
        stream = ReactionStream(
            55, judge, send, question=lambda seq: "질문", criteria=lambda seq: "기준"
        )
        stream.start(1, "candidate")
        stream.submit("문장.", 0.0, "문장.")
        await judge.started.wait()
        await stream.stop()
        assert stream.attitude == NEUTRAL_ATTITUDE
        return sent

    assert asyncio.run(main()) == []


def test_chat_applies_only_latest_input_even_if_older_finishes_first() -> None:
    async def main() -> Harness:
        h = Harness()
        h.stream = ReactionStream(
            55,
            h.judge,
            h.send,
            question=lambda seq: "질문",
            criteria=lambda seq: "기준",
            latest_only=True,
        )
        h.stream.start(1, "candidate")
        h.stream.submit("지운 글", 0.0, "지운 글")
        h.stream.submit("고친 글", 0.0, "고친 글")
        await h.settle()
        h.judge.finish(0, Judgment(SMILE, Attitude(0.9, 0.9)))
        await h.settle()
        h.judge.finish(1, Judgment(None, Attitude(0.4, 0.4)))
        await h.settle()
        await h.stream.stop()
        return h

    h = asyncio.run(main())
    # 먼저 끝난 이전 입력의 판단은 전송하지도 태도에 반영하지도 않는다(AI 명세 6.4)
    assert [m["seq"] for m in h.sent] == [2]
    assert h.stream.attitude == Attitude(0.4, 0.4)


def test_chat_input_is_parsed_and_reply_has_only_accepted() -> None:
    payload = json.dumps(
        {
            "type": "chat.input",
            "sessionId": 55,
            "questionSeq": 2,
            "seq": 3,
            "text": "입력 칸 전체",
            "pauseMs": 812.5,
        }
    )
    assert parse_chat_input(payload, 55) == ChatInput(2, 3, "입력 칸 전체", 812.5)
    assert json.loads(chat_input_reply(True)) == {"accepted": True}
    assert json.loads(chat_input_reply(False)) == {"accepted": False}
    assert CHAT_INPUT_METHOD == "interview.chatInput"


LONG_TOKENS = (SpeechToken("답변", 0, 60_000), SpeechToken(" 계속", 60_000, MAX_SPEAKING_MS))
SHORT_TOKENS = (SpeechToken("답변", 0, 1_000),)


def video_stream(h: Harness, persona: Persona | None = Persona.DEVIL) -> ReactionStream:
    return ReactionStream(
        55,
        h.judge,
        h.send,
        question=lambda seq: "질문",
        criteria=lambda seq: "기준",
        persona=persona,
    )


def test_off_topic_interrupt_is_sent_with_judgment_once_per_answer() -> None:
    async def scenario(h: Harness) -> None:
        h.stream = video_stream(h)
        h.stream.start(1, "candidate")
        for index in range(2):
            h.stream.submit("등산 얘기.", 0.0, "등산 얘기.")
            await h.settle()
            h.judge.finish(index, Judgment(None, NEUTRAL_ATTITUDE, off_topic=0.9))
            await h.settle()

    h = run(scenario)
    assert [m["interrupt"] for m in h.sent] == [
        {"reason": "OFF_TOPIC", "text": "질문으로 다시 돌아가 볼게요."},
        None,
    ]


def test_too_long_is_sent_on_speech_without_waiting_for_jev() -> None:
    async def scenario(h: Harness) -> None:
        h.stream = video_stream(h)
        h.stream.start(1, "candidate")
        h.stream.speaking(SHORT_TOKENS)
        h.stream.speaking(LONG_TOKENS)
        h.stream.speaking(LONG_TOKENS)
        await h.settle()

    h = run(scenario)
    assert h.judge.contexts == []
    assert [(m["seq"], m["reaction"], m["interrupt"]["reason"]) for m in h.sent] == [
        (1, None, "TOO_LONG")
    ]


def test_unknown_speaking_time_does_not_interrupt() -> None:
    async def scenario(h: Harness) -> None:
        h.stream = video_stream(h)
        h.stream.start(1, "candidate")
        h.stream.speaking(None)
        await h.settle()

    assert run(scenario).sent == []


def test_rejoined_answer_can_be_interrupted_again() -> None:
    async def scenario(h: Harness) -> None:
        h.stream = video_stream(h)
        h.stream.start(1, "candidate")
        h.stream.speaking(LONG_TOKENS)
        await h.settle()
        await h.stream.stop()
        h.stream.start(1, "candidate")
        h.stream.speaking(LONG_TOKENS)
        await h.settle()

    h = run(scenario)
    assert [(m["seq"], m["interrupt"]["reason"]) for m in h.sent] == [
        (1, "TOO_LONG"),
        (2, "TOO_LONG"),
    ]


def test_chat_never_interrupts() -> None:
    async def scenario(h: Harness) -> None:
        h.stream = video_stream(h, persona=None)
        h.stream.start(1, "candidate")
        h.stream.speaking(LONG_TOKENS)
        h.stream.submit("등산 얘기.", 0.0, "등산 얘기.")
        await h.settle()
        h.judge.finish(0, Judgment(None, NEUTRAL_ATTITUDE, off_topic=0.9))
        await h.settle()

    h = run(scenario)
    assert [m["interrupt"] for m in h.sent] == [None]


def test_interrupt_is_handed_to_runner_for_notice_voice() -> None:
    interrupts: list[str] = []

    async def scenario(h: Harness) -> None:
        h.stream = video_stream(h)
        h.stream.on_interrupt = lambda interrupt: interrupts.append(interrupt.reason.value)
        h.stream.start(1, "candidate")
        h.stream.speaking(LONG_TOKENS)
        await h.settle()

    run(scenario)
    assert interrupts == ["TOO_LONG"]


# 기준: AI 명세 6.2 호응(칭찬은 그 답변에서 Jev가 판단한 마지막 결과로 선택한다)
def test_last_judgment_keeps_latest_judged_result_until_next_answer() -> None:
    async def scenario(h: Harness) -> None:
        h.stream.start(1, "candidate")
        h.stream.submit("첫째.", 0.0, "첫째.")
        await h.settle()
        h.judge.finish(0, Judgment(SMILE, Attitude(0.8, 0.6)))
        await h.settle()
        h.stream.submit("둘째.", 0.0, "첫째. 둘째.")
        await h.settle()
        h.judge.finish(1, Judgment(None, Attitude(0.8, 0.6), judged=False))
        await h.settle()
        await h.stream.stop()
        assert h.stream.last_judgment == Judgment(SMILE, Attitude(0.8, 0.6))
        h.stream.start(2, "candidate")
        assert h.stream.last_judgment is None

    run(scenario)


def test_too_long_interrupt_is_not_a_judgment_for_praise() -> None:
    async def scenario(h: Harness) -> None:
        h.stream = video_stream(h, Persona.DUCK)
        h.stream.start(1, "candidate")
        h.stream.speaking(LONG_TOKENS)
        await h.settle()
        assert h.stream.last_judgment is None

    run(scenario)


def test_chat_last_judgment_ignores_older_input_result() -> None:
    async def main() -> Harness:
        h = Harness()
        h.stream = ReactionStream(
            55,
            h.judge,
            h.send,
            question=lambda seq: "질문",
            criteria=lambda seq: "기준",
            latest_only=True,
        )
        h.stream.start(1, "candidate")
        h.stream.submit("지운 글", 0.0, "지운 글")
        await h.settle()
        h.judge.finish(0, Judgment(SMILE, Attitude(0.9, 0.9)))
        await h.settle()
        h.stream.submit("고친 글", 0.0, "고친 글")
        h.stream.submit("다시 고친 글", 0.0, "다시 고친 글")
        await h.settle()
        h.judge.finish(1, Judgment(None, Attitude(0.1, 0.1)))
        await h.settle()
        await h.stream.stop()
        return h

    h = asyncio.run(main())
    # 마지막 입력의 판단이 끝나기 전에 답변이 끝났으므로 앞서 적용한 판단이 남는다
    assert h.stream.last_judgment == Judgment(SMILE, Attitude(0.9, 0.9))
