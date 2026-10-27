"""브라우저 구현에서 옮긴 문장 끝 판단 예문을 검증한다.

예문은 로컬 실측(조용한 곳)에서 끝 감지가 발생한 글이다.
"""

import pytest

from app.interview.realtime.sentence import (
    Sentence,
    SentenceTracker,
    has_endpoint,
    last_sentence,
)
from app.interview.realtime.transcript import SonioxToken, Transcript
from app.interview.speech import ends_sentence
from tests.interview.realtime.replay import FIRST_SENTENCE, SECOND_SENTENCE, load_responses


def token(text: str, end_ms: float | None, is_final: bool = True) -> SonioxToken:
    start_ms = None if end_ms is None else end_ms - 100
    return SonioxToken(text=text, start_ms=start_ms, end_ms=end_ms, is_final=is_final)


class Listening:
    """응답을 전사 상태에 반영하고 같은 전사 상태로 문장 끝을 판단한다."""

    def __init__(self) -> None:
        self.transcript = Transcript()
        self.transcript.begin_connection(0)
        self.tracker = SentenceTracker(self.transcript)

    def apply(self, tokens: list[SonioxToken]) -> "Listening":
        self.transcript.apply(tokens)
        return self

    def on_endpoint(self, total_audio_proc_ms: float) -> Sentence | None:
        return self.tracker.on_endpoint(total_audio_proc_ms)


def heard(text: str, end_ms: float = 1_000) -> Listening:
    """확정 토큰 하나로 된 응답을 반영한 상태."""
    return Listening().apply([token(text, end_ms)])


@pytest.mark.parametrize(
    "text",
    [
        "경험입니다.",
        "찾았습니다.",
        "줄였어요.",
        "될까요?",
        "그렇죠",
        "했습니다!",
        "했습니다...",
        "했습니다… ",
    ],
)
def test_sentence_ending(text: str) -> None:
    assert ends_sentence(text)


@pytest.mark.parametrize("text", ["음.", "몰랐는데,", "결과.", "줄였습니다,", "", "   "])
def test_not_sentence_ending(text: str) -> None:
    assert not ends_sentence(text)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("결제 서버를 맡았습니다. 응답이 느렸습니다.", "응답이 느렸습니다."),
        # 종결어미 없이 끝난 작성 중인 글도 한 문장이다
        ("결제 서버를 맡았습니다. 가장 어려웠던 건", "가장 어려웠던 건"),
        ("결제 서버를 맡았습니다.", "결제 서버를 맡았습니다."),
        ("결제 서버를 맡았고", "결제 서버를 맡았고"),
        # 쉼표로 끝난 어절은 문장 경계가 아니다
        ("줄였습니다, 그래서 빨라졌습니다.", "줄였습니다, 그래서 빨라졌습니다."),
        ("맡았습니다.\n줄였어요 ", "줄였어요"),
        ("", ""),
    ],
)
def test_last_sentence_of_chat_input(text: str, expected: str) -> None:
    assert last_sentence(text) == expected


def test_endpoint_after_ending_returns_sentence_and_resets() -> None:
    listening = heard(" 경험입니다.", 2_000)

    assert listening.on_endpoint(3_150) == Sentence(text="경험입니다.", pause_ms=1_150)
    assert listening.tracker.text == ""
    assert listening.on_endpoint(4_000) is None


def test_text_without_ending_is_kept_until_next_endpoint() -> None:
    listening = heard(" 몰랐는데,", 1_000)
    assert listening.on_endpoint(4_000) is None

    listening.apply([token(" 결국", 5_000), token(" 찾았습니다.", 5_600)])

    assert listening.on_endpoint(6_700) == Sentence(
        text="몰랐는데, 결국 찾았습니다.", pause_ms=1_100
    )


@pytest.mark.parametrize("text", ["음.", "결과."])
def test_endpoint_without_ending_is_not_sentence_end(text: str) -> None:
    assert heard(text).on_endpoint(2_000) is None


def test_pending_token_blocks_sentence_end() -> None:
    listening = Listening().apply(
        [token("줄였어요.", 1_000), token(" 그리고", 1_300, is_final=False)]
    )

    assert listening.on_endpoint(2_000) is None


def test_pending_text_is_not_included() -> None:
    listening = Listening().apply(
        [token("그래서", 1_000), token(" 줄였어요.", 1_400, is_final=False)]
    )

    assert listening.tracker.text == "그래서"
    assert listening.on_endpoint(2_000) is None


def test_negative_pause_becomes_zero() -> None:
    sentence = heard("됐어요.", 2_000).on_endpoint(1_900)

    assert sentence is not None
    assert sentence.pause_ms == 0


def test_last_non_space_token_end_is_used() -> None:
    listening = Listening().apply([token("됐어요.", 1_000), token(" ", 1_500), token("", None)])

    sentence = listening.on_endpoint(1_800)
    assert sentence is not None
    assert sentence.pause_ms == 800


def test_untimed_last_token_uses_previous_timed_token() -> None:
    listening = Listening().apply([token("됐", 1_000), token("어요.", None)])

    sentence = listening.on_endpoint(1_800)
    assert sentence is not None
    assert sentence.pause_ms == 800


def test_previous_sentence_end_is_not_used_for_next_sentence() -> None:
    listening = heard("됐어요.", 1_000)
    assert listening.on_endpoint(1_500) is not None

    listening.apply([token(" 네.", None)])

    assert listening.on_endpoint(9_000) is None
    listening.apply([token(" 맞아요.", None)])
    sentence = listening.on_endpoint(9_000)
    assert sentence == Sentence(text="네. 맞아요.", pause_ms=0)


def test_new_connection_drops_previous_end_and_keeps_text() -> None:
    listening = heard("그래서", 9_000)
    assert listening.on_endpoint(10_000) is None

    listening.transcript.begin_connection(10_000)
    assert listening.tracker.text == "그래서"
    assert listening.on_endpoint(500) is None
    listening.apply([token(" 줄였어요.", 400)])

    assert listening.on_endpoint(1_000) == Sentence(text="그래서 줄였어요.", pause_ms=600)

    reconnected = heard("됐어요.")
    reconnected.transcript.begin_connection(2_000)
    sentence = reconnected.on_endpoint(5_000)
    assert sentence is not None
    assert sentence.pause_ms == 0


def test_sentence_is_trimmed_and_empty_text_is_not_sent() -> None:
    listening = Listening().apply([token("  다", 0)])

    assert listening.on_endpoint(0) == Sentence(text="다", pause_ms=0)
    assert Listening().on_endpoint(0) is None


def test_long_sentence_keeps_last_characters() -> None:
    long = "가" * 1_200 + "습니다."

    sentence = heard(long).on_endpoint(2_000)

    assert sentence is not None
    assert len(sentence.text) == 1_000
    assert sentence.text.endswith("습니다.")


def test_endpoint_marker_in_server_response_is_detected_and_not_appended() -> None:
    # 서버는 Soniox 응답을 그대로 수신하므로 브라우저 SDK가 처리하던 <end> 토큰이 응답에 포함된다
    tokens = [token("줄였어요.", 1_000), token("<end>", 1_000)]
    listening = Listening().apply(tokens)

    assert has_endpoint(tokens)
    assert not has_endpoint([token("<fin>", 1_000), token("네", 1_100)])
    assert listening.on_endpoint(1_200) == Sentence(text="줄였어요.", pause_ms=200)


def test_real_soniox_responses_give_two_sentences_with_pause() -> None:
    listening = Listening()
    sentences: list[Sentence] = []
    endpoints = 0
    for response in load_responses():
        listening.apply(list(response.tokens))
        if has_endpoint(response.tokens):
            endpoints += 1
            sentence = listening.on_endpoint(response.total_audio_proc_ms)
            if sentence is not None:
                sentences.append(sentence)

    # 끝 감지는 문장 확정 토큰과 같은 응답에 도착하고, 그 응답의 미확정 토큰은 0개다
    assert endpoints == 2
    assert sentences == [
        Sentence(text=FIRST_SENTENCE, pause_ms=1_320),
        Sentence(text=SECOND_SENTENCE, pause_ms=600),
    ]
    # 같은 응답으로 만든 답변 글과 문장이 일치한다
    assert listening.transcript.content() == " ".join(each.text for each in sentences)
