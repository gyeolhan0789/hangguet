"""다시보기 체크포인트 보완할 점 문구 시험(AI 명세 4장 다시보기 타임라인 문구)."""

from collections.abc import Mapping, Sequence
from typing import Any

from app.common.gms import GmsResult, GmsUnavailableError
from app.interview.result.timeline import Checkpoint, Metric, Reason
from app.interview.result.timeline_feedback import (
    DEFAULT_TEXTS,
    MAX_TEXT_LENGTH,
    CheckpointForFeedback,
    build_messages,
    write_texts,
)

CHECKPOINT = Checkpoint(
    at_ms=31_000,
    start_ms=30_000,
    end_ms=35_000,
    value=-2.1,
    reasons=(Reason(Metric.CONFIDENCE, None), Reason(Metric.FILLER, 3)),
)
ITEM = CheckpointForFeedback(
    answer_id=903, question="가장 큰 문제는?", spoken="음, 그러니까", checkpoint=CHECKPOINT
)
REPLY = {
    "checkpoints": [
        {
            "id": "c1",
            "reasons": [
                {"metric": "CONFIDENCE", "text": "고개를 들고 말해 보세요."},
                {"metric": "FILLER", "text": "잠깐 멈춰도 괜찮아요."},
            ],
        }
    ]
}


class FakeChat:
    def __init__(self, *outcomes: Mapping[str, Any] | Exception) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[Sequence[Mapping[str, str]]] = []

    def __call__(self, messages: Sequence[Mapping[str, str]]) -> GmsResult:
        self.calls.append(messages)
        item = self.outcomes.pop(0)
        if isinstance(item, Exception):
            raise item
        return GmsResult(dict(item), "gpt-timeline")


def test_texts_for_every_reason_in_one_call() -> None:
    chat = FakeChat(REPLY)
    models: set[str] = set()

    texts = write_texts([ITEM], chat, models)

    assert texts == {
        (903, 31_000, Metric.CONFIDENCE): "고개를 들고 말해 보세요.",
        (903, 31_000, Metric.FILLER): "잠깐 멈춰도 괜찮아요.",
    }
    assert len(chat.calls) == 1
    assert models == {"gpt-timeline"}


def test_prompt_has_question_spoken_text_and_reasons_with_counts() -> None:
    user = build_messages([ITEM])[1]["content"]

    assert "질문: 가장 큰 문제는?" in user
    assert "그때 말한 글: 음, 그러니까" in user
    assert "CONFIDENCE(자신감)" in user
    assert "FILLER(군말): 3회" in user


def test_broken_reply_is_retried_once() -> None:
    broken = {"checkpoints": [{"id": "c1", "reasons": [{"metric": "CONFIDENCE", "text": "a"}]}]}
    chat = FakeChat(broken, REPLY)

    texts = write_texts([ITEM], chat, set())

    assert texts[(903, 31_000, Metric.FILLER)] == "잠깐 멈춰도 괜찮아요."
    assert len(chat.calls) == 2


def test_still_broken_reply_falls_back_to_default_texts() -> None:
    too_long = {
        "checkpoints": [
            {
                "id": "c1",
                "reasons": [
                    {"metric": "CONFIDENCE", "text": "가" * (MAX_TEXT_LENGTH + 1)},
                    {"metric": "FILLER", "text": "멈춰도 돼요."},
                ],
            }
        ]
    }

    texts = write_texts([ITEM], FakeChat(too_long, too_long), set())

    assert texts == {
        (903, 31_000, Metric.CONFIDENCE): DEFAULT_TEXTS[Metric.CONFIDENCE],
        (903, 31_000, Metric.FILLER): DEFAULT_TEXTS[Metric.FILLER],
    }


def test_gms_failure_falls_back_to_default_texts() -> None:
    texts = write_texts([ITEM], FakeChat(GmsUnavailableError("503")), set())

    assert texts[(903, 31_000, Metric.CONFIDENCE)] == DEFAULT_TEXTS[Metric.CONFIDENCE]


def test_no_reasons_does_not_call_gms() -> None:
    chat = FakeChat()

    assert write_texts([], chat, set()) == {}
    assert chat.calls == []


def test_every_metric_has_default_text_within_limit() -> None:
    assert set(DEFAULT_TEXTS) == set(Metric)
    assert all(len(text) <= MAX_TEXT_LENGTH for text in DEFAULT_TEXTS.values())
