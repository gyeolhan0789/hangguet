"""브라우저 구현에서 옮긴 토큰 처리 예문을 검증한다.

브라우저 보정(첫 음성 - 파일 시작)을 다루던 예문은 서버 스트림 기준 offset 예문으로 대체한다.
브라우저의 자막(getCaption)은 확정 글(confirmed_text)과 미확정 글(interim_text)로 나누어 확인한다.
"""

import pytest

from app.common.answer import SpeechToken
from app.interview.realtime.transcript import (
    MAX_ANSWER_TOKENS,
    SonioxToken,
    Transcript,
    soniox_tokens,
)
from tests.interview.realtime.replay import FIRST_SENTENCE, SECOND_SENTENCE, load_responses


def token(
    text: str, start_ms: float | None, end_ms: float | None, is_final: bool = True
) -> SonioxToken:
    return SonioxToken(text=text, start_ms=start_ms, end_ms=end_ms, is_final=is_final)


def connected(offset_ms: float, *results: list[SonioxToken]) -> Transcript:
    """offset으로 연결을 시작하고 응답을 차례로 반영한다."""
    transcript = Transcript()
    transcript.begin_connection(offset_ms)
    for result in results:
        transcript.apply(result)
    return transcript


def test_real_soniox_responses_give_original_text_and_48_tokens() -> None:
    transcript = Transcript()
    transcript.begin_connection(0)
    for response in load_responses():
        transcript.apply(response.tokens)

    tokens = transcript.answer_tokens()

    assert transcript.content() == f"{FIRST_SENTENCE} {SECOND_SENTENCE}"
    assert tokens is not None
    assert len(tokens) == 48
    assert tokens[0] == SpeechToken("음", 960, 1020)
    assert all(each.text not in ("<end>", "<fin>") for each in tokens)
    starts = [each.start_ms for each in tokens]
    assert starts == sorted(starts)


def test_final_tokens_are_appended_per_result() -> None:
    transcript = connected(0, [token("안녕", 0, 300)], [token("하세요", 300, 600)])

    assert transcript.content() == "안녕하세요"


def test_partial_tokens_are_excluded_from_content_and_tokens() -> None:
    transcript = connected(
        0,
        [token("저는", 0, 300), token(" 개", 300, 400, is_final=False)],
        [token(" 개발자", 300, 700, is_final=False)],
    )

    assert transcript.content() == "저는"
    assert transcript.answer_tokens() == (SpeechToken("저는", 0, 300),)
    # 미확정 글은 응답마다 전체가 변경되고 자막에만 사용한다
    assert transcript.confirmed_text == "저는"
    assert transcript.interim_text == " 개발자"


def test_end_and_fin_markers_are_excluded_everywhere() -> None:
    transcript = connected(
        0,
        [
            token("네", 0, 200),
            token("<end>", 200, 200),
            token("<fin>", 200, 200),
            token("<end>", 200, 200, is_final=False),
        ],
    )

    assert transcript.content() == "네"
    assert transcript.confirmed_text == "네"
    assert transcript.interim_text == ""
    assert transcript.answer_tokens() == (SpeechToken("네", 0, 200),)


def test_confirmed_text_keeps_surrounding_spaces_for_caption() -> None:
    transcript = connected(0, [token(" 네", 0, 200), token(" ", 200, 210)])

    assert transcript.confirmed_text == " 네 "
    assert transcript.content() == "네"


def test_spaces_are_kept_in_tokens_and_trimmed_only_in_content() -> None:
    transcript = connected(
        0,
        [
            token(" ", 0, 10),
            token("How", 10, 200),
            token(" ", 200, 210),
            token("are", 210, 400),
            token(" you", 400, 600),
            token(" ", 600, 610),
        ],
    )

    assert transcript.content() == "How are you"
    tokens = transcript.answer_tokens()
    assert tokens is not None
    assert [each.text for each in tokens] == [" ", "How", " ", "are", " you", " "]


def test_offset_is_added() -> None:
    assert connected(300, [token("네", 100, 200)]).answer_tokens() == (SpeechToken("네", 400, 500),)


def test_offset_is_rounded_after_adding_with_half_up() -> None:
    assert connected(10.6, [token("네", 100, 200)]).answer_tokens() == (
        SpeechToken("네", 111, 211),
    )
    # 16kHz 16bit 음성은 1밀리초가 32바이트라 offset에 .5가 생길 수 있다.
    # 브라우저 Math.round와 같이 올림한다
    assert connected(0.5, [token("네", 100, 200)]).answer_tokens() == (SpeechToken("네", 101, 201),)


def test_reconnection_adds_each_connection_offset_and_keeps_order() -> None:
    transcript = connected(200, [token("첫", 0, 100), token(" 미확정", 100, 300, is_final=False)])
    transcript.begin_connection(5000)
    # 앞 연결의 미확정 글은 새 연결에서 다시 수신하지 않으므로, 새 응답 전에도 자막에서 제외한다
    assert transcript.interim_text == ""
    transcript.apply([token(" 둘째", 0, 150)])

    assert transcript.content() == "첫 둘째"
    assert transcript.answer_tokens() == (
        SpeechToken("첫", 200, 300),
        SpeechToken(" 둘째", 5000, 5150),
    )


def test_reconnected_real_responses_stay_monotonic() -> None:
    responses = load_responses()
    middle = len(responses) // 2
    transcript = Transcript()
    transcript.begin_connection(0)
    for response in responses[:middle]:
        transcript.apply(response.tokens)
    # 재연결하면 Soniox 시각이 0부터 다시 시작하므로 앞 연결의 음성 길이를 offset으로 전달한다
    first_length = responses[middle - 1].total_audio_proc_ms
    transcript.begin_connection(first_length)
    for response in responses[middle:]:
        transcript.apply(
            [
                token(
                    each.text,
                    None if each.start_ms is None else max(0.0, each.start_ms - first_length),
                    None if each.end_ms is None else max(0.0, each.end_ms - first_length),
                    each.is_final,
                )
                for each in response.tokens
            ]
        )

    tokens = transcript.answer_tokens()

    assert tokens is not None
    starts = [each.start_ms for each in tokens]
    assert starts == sorted(starts)
    assert all(each.end_ms >= each.start_ms for each in tokens)


def test_token_with_equal_start_and_end_is_valid() -> None:
    # 실제 응답의 마침표처럼 길이가 0인 토큰은 endMs ≥ startMs 조건을 만족한다
    assert connected(0, [token(".", 2400, 2400)]).answer_tokens() == (SpeechToken(".", 2400, 2400),)


def test_negative_offset_is_rejected() -> None:
    # 서버 스트림 기준 offset은 이미 전송한 음성 길이이므로 음수가 될 수 없다
    with pytest.raises(ValueError):
        Transcript().begin_connection(-1)


def test_exactly_max_tokens_are_sent() -> None:
    tokens = [token("가", i, i + 1) for i in range(MAX_ANSWER_TOKENS)]

    result = connected(0, tokens).answer_tokens()

    assert MAX_ANSWER_TOKENS == 10_000
    assert result is not None
    assert len(result) == MAX_ANSWER_TOKENS


@pytest.mark.parametrize(
    "tokens",
    [
        pytest.param([token("네", -1, 300)], id="startMs below zero"),
        pytest.param([token("네", 300, 200)], id="endMs below startMs"),
        pytest.param([token("네", None, 200)], id="start_ms missing"),
        pytest.param([token("네", 100, None)], id="end_ms missing"),
        pytest.param([token("", 100, 200)], id="empty text"),
        pytest.param(
            [token("가", i, i + 1) for i in range(MAX_ANSWER_TOKENS)], id="over max tokens"
        ),
    ],
)
def test_any_invalid_token_drops_all_tokens_but_keeps_content(tokens: list[SonioxToken]) -> None:
    transcript = connected(0, [token("정상", 0, 100)], tokens)

    assert transcript.answer_tokens() is None
    assert transcript.content().startswith("정상")


def test_speech_end_includes_partial_tokens() -> None:
    assert connected(0, [token("안녕", 0, 400, is_final=False)]).speech_end_ms == 400
    assert (
        connected(0, [token("안녕", 0, 400), token("하", 400, 500, is_final=False)]).speech_end_ms
        == 500
    )


def test_speech_end_keeps_maximum_when_later_token_ends_earlier() -> None:
    # 미확정 글은 응답마다 다시 계산되므로 뒤 토큰의 end_ms가 앞 토큰보다 작을 수 있다
    transcript = connected(
        0, [token("안녕", 0, 500, is_final=False), token("하", 400, 450, is_final=False)]
    )

    assert transcript.speech_end_ms == 500
    transcript.apply([token("안", 0, 300, is_final=False)])
    assert transcript.speech_end_ms == 500


def test_speech_end_ignores_space_markers_and_untimed_tokens() -> None:
    transcript = connected(0, [token("네", 0, 300)], [token(" ", 300, 900, is_final=False)])

    assert transcript.speech_end_ms == 300
    transcript.apply([token("음", 0, None, is_final=False), token("<end>", 2000, 2000)])
    assert transcript.speech_end_ms == 300


def test_speech_end_resets_on_new_connection() -> None:
    transcript = connected(
        0, [token("네", 0, 300, is_final=False)], [token("네", 0, 300, is_final=False)]
    )

    assert transcript.speech_end_ms == 300
    transcript.begin_connection(1000)
    assert transcript.speech_end_ms is None


def test_soniox_response_json_is_converted_with_optional_timing() -> None:
    response = {
        "tokens": [
            {"text": "네", "start_ms": 0, "end_ms": 200, "is_final": True},
            {"text": " ", "is_final": False},
        ],
        "final_audio_proc_ms": 200,
    }

    assert soniox_tokens(response) == (
        SonioxToken("네", 0, 200, is_final=True),
        SonioxToken(" ", None, None, is_final=False),
    )


def test_soniox_response_without_tokens_is_empty() -> None:
    """종료 응답(finished)처럼 tokens가 없는 응답도 처리한다."""
    assert soniox_tokens({"finished": True}) == ()


def test_pending_token_without_text_still_counts_as_interim() -> None:
    """문장 끝 판단은 글이 없어도 미확정 토큰이 남아 있으면 기다린다."""
    transcript = connected(0, [token("네", 0, 200), token("", 200, 300, is_final=False)])

    assert transcript.interim_text == ""
    assert transcript.has_interim
    transcript.apply([token(" 맞아요", 300, 600)])
    assert not transcript.has_interim


def test_confirmed_text_and_last_end_since_position() -> None:
    transcript = connected(0, [token("첫", 0, 100), token(" 둘", 100, 200), token(" ", 200, 250)])

    assert transcript.final_count == 3
    assert transcript.confirmed_since(1) == " 둘 "
    assert transcript.last_end_ms_since(1) == 200
    assert transcript.last_end_ms_since(3) is None
