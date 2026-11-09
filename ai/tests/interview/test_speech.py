import pytest

from app.common.answer import SttGap
from app.interview.speech import (
    LONG_PAUSE_MS,
    aggregate_speech_metrics,
    ends_sentence,
    group_words,
    is_filler,
    speech_metrics,
)

# 목 서버 5.7 화상 예시 토큰(공백이 별도 토큰인 형태, mock InterviewSessionController ANSWER_VOICE)
MOCK_TOKENS = [
    {"text": "조회", "startMs": 0, "endMs": 280},
    {"text": " ", "startMs": 280, "endMs": 320},
    {"text": "응답", "startMs": 320, "endMs": 600},
    {"text": " ", "startMs": 600, "endMs": 640},
    {"text": "시간", "startMs": 640, "endMs": 900},
    {"text": "을", "startMs": 900, "endMs": 1000},
    {"text": " ", "startMs": 1000, "endMs": 1180},
    {"text": "40", "startMs": 1180, "endMs": 1500},
    {"text": "%", "startMs": 1500, "endMs": 1700},
    {"text": " ", "startMs": 1700, "endMs": 1740},
    {"text": "줄", "startMs": 1740, "endMs": 1900},
    {"text": "였", "startMs": 1900, "endMs": 2050},
    {"text": "습니다", "startMs": 2050, "endMs": 2400},
    {"text": ".", "startMs": 2400, "endMs": 2400},
]


def tok(text: str, start: int, end: int) -> dict[str, object]:
    return {"text": text, "startMs": start, "endMs": end}


def words_of(tokens: list[dict[str, object]]) -> list[tuple[str, int, int]]:
    return [(w.text, w.start_ms, w.end_ms) for w in group_words(tokens)]


def test_group_words_with_separate_space_tokens() -> None:
    """공백이 별도인 토큰을 단어로 묶고, 단어 시각은 첫 토큰부터 마지막 토큰까지다."""
    assert words_of(MOCK_TOKENS) == [
        ("조회", 0, 280),
        ("응답", 320, 600),
        ("시간을", 640, 1000),
        ("40%", 1180, 1700),
        ("줄였습니다.", 1740, 2400),
    ]


def test_group_words_with_leading_space_tokens() -> None:
    """공백이 단어 앞에 붙어 있어도 같은 단어 목록이다."""
    attached = [
        tok("조회", 0, 280),
        tok(" 응답", 320, 600),
        tok(" 시간", 640, 900),
        tok("을", 900, 1000),
    ]
    assert words_of(attached) == [("조회", 0, 280), ("응답", 320, 600), ("시간을", 640, 1000)]


def test_group_words_with_trailing_space_tokens() -> None:
    """공백이 단어 뒤에 붙어 있어도 같은 단어 목록이다."""
    trailing = [
        tok("조회 ", 0, 280),
        tok("응답 ", 320, 600),
        tok("시간", 640, 900),
        tok("을", 900, 1000),
    ]
    assert words_of(trailing) == [("조회", 0, 280), ("응답", 320, 600), ("시간을", 640, 1000)]


def test_group_words_joins_subwords() -> None:
    assert words_of([tok(" Beau", 0, 100), tok("ti", 100, 200), tok("ful", 200, 300)]) == [
        ("Beautiful", 0, 300)
    ]


def test_punctuation_token_does_not_extend_word_end() -> None:
    """Soniox가 멈춘 뒤의 시각에 둔 문장 부호가 단어를 늘려 긴 멈춤을 가리지 않는다.

    stt-rt-v6 실제 응답의 시각 배치(멈춤 2.3초 뒤에 "."가 온다)를 줄인 것이다.
    """
    tokens = [
        tok("문", 1_620, 1_680),
        tok("제", 1_740, 1_800),
        tok("는", 1_980, 2_040),
        tok(".", 4_380, 4_440),
        tok(" 동", 4_860, 4_920),
        tok("시에", 5_040, 5_100),
    ]
    assert words_of(tokens) == [("문제는.", 1_620, 2_040), ("동시에", 4_860, 5_100)]
    metrics = speech_metrics(tokens)
    assert metrics is not None
    assert metrics["longPauseCount"] == 1
    assert metrics["speakingMs"] == 5_100 - 1_620 - (4_860 - 2_040)


def test_word_of_only_punctuation_keeps_its_time() -> None:
    """앞에 글자가 없는 문장 부호 토큰은 그 토큰의 시각을 그대로 쓴다."""
    assert words_of([tok(" ...", 100, 200)]) == [("...", 100, 200)]


@pytest.mark.parametrize("word", ["음", "음.", "어,", "어...", "음음", "어어", "흠"])
def test_hesitation_is_always_filler(word: str) -> None:
    assert is_filler(word)


@pytest.mark.parametrize("word", ["그,", "이제.", "뭔가…", "그러니까,"])
def test_discourse_marker_cut_off_is_filler(word: str) -> None:
    """담화 표지는 쉼표·마침표·말줄임표로 단독으로 끊길 때만 군말로 집계한다."""
    assert is_filler(word)


@pytest.mark.parametrize("word", ["그", "이제", "좀", "음성", "어떻게", "아니요"])
def test_connected_marker_and_plain_word_are_not_filler(word: str) -> None:
    assert not is_filler(word)


@pytest.mark.parametrize(
    ("word", "expected"),
    [
        # FE 화상 문장 끝(sentence-end.test.ts)과 같은 예문을 사용한다
        ("경험입니다.", True),
        ("찾았습니다.", True),
        ("줄였어요.", True),
        ("줄였습니다.", True),
        ("될까요?", True),
        ("그렇죠", True),
        ("했습니다!", True),
        ("했습니다...", True),
        ("했습니다…", True),
        ("몰랐는데,", False),
        ("결과.", False),
        ("음.", False),
        ("줄였습니다,", False),
    ],
)
def test_ends_sentence_follows_api_spec_5_11(word: str, expected: bool) -> None:
    assert ends_sentence(word) is expected


def test_metrics_of_mock_example_tokens() -> None:
    # 한글 음절: 조회 응답 시간을 줄였습니다 = 2+2+3+5 = 12, 발화 시간 2,400ms
    assert speech_metrics(MOCK_TOKENS) == {
        "fillerCount": 0,
        "speakingMs": 2_400,
        "longPauseCount": 0,
        "syllablesPerMin": 300,
    }


def test_long_pause_counts_mid_sentence_gap_of_two_seconds() -> None:
    """문장 중간 2초 이상 멈춤만 집계하고 발화 시간에서 제외한다."""
    tokens = [
        tok("캐시를", 0, 500),
        tok(" 도입한", 500 + LONG_PAUSE_MS, 3_000),
        tok(" 이유는", 3_000 + LONG_PAUSE_MS - 1, 5_500),
    ]
    metrics = speech_metrics(tokens)
    assert metrics is not None
    assert metrics["longPauseCount"] == 1
    assert metrics["speakingMs"] == 5_500 - LONG_PAUSE_MS


def test_pause_between_sentences_is_not_long_pause() -> None:
    """앞 단어가 문장 끝이면 문장 사이 휴지이므로 집계하지 않는다."""
    tokens = [tok("줄였습니다.", 0, 1_000), tok(" 그리고", 5_000, 5_400)]
    metrics = speech_metrics(tokens)
    assert metrics is not None
    assert metrics["longPauseCount"] == 0
    assert metrics["speakingMs"] == 5_400


def test_filler_count() -> None:
    tokens = [
        tok("음,", 0, 300),
        tok(" 그", 400, 500),
        tok(" 사람이", 500, 900),
        tok(" 그,", 1_000, 1_100),
    ]
    metrics = speech_metrics(tokens)
    assert metrics is not None
    assert metrics["fillerCount"] == 2


@pytest.mark.parametrize("tokens", [None, [], [tok(" ", 0, 10)]])
def test_no_tokens_gives_none(tokens: list[dict[str, object]] | None) -> None:
    assert speech_metrics(tokens) is None


def test_zero_speaking_time_gives_no_speed() -> None:
    metrics = speech_metrics([tok("네.", 100, 100)])
    assert metrics is not None
    assert metrics["syllablesPerMin"] is None


def test_speed_rounds_half_up() -> None:
    """5음절을 960ms 동안 발화하면 312.5음절/분이고 313으로 반올림한다."""
    metrics = speech_metrics([tok("가나다라마", 0, 960)])
    assert metrics is not None
    assert metrics["syllablesPerMin"] == 313


def answer_metrics(ms: int | None, **values: int | float | None) -> dict[str, object]:
    return {"speakingMs": ms, **values}


def test_session_filler_rate_and_pause_sum() -> None:
    assert aggregate_speech_metrics(
        [
            answer_metrics(60_000, fillerCount=3, longPauseCount=1),
            answer_metrics(30_000, fillerCount=2, longPauseCount=2),
        ]
    ) == {
        "fillerPerMin": 3.33,
        "longPauseCount": 3,
        "speedDeviationPct": None,
        "trailingOffRatio": None,
        "pitchRangeSt": None,
    }


def test_session_metrics_have_no_gaze_ratio() -> None:
    assert set(aggregate_speech_metrics([])) == {
        "fillerPerMin",
        "longPauseCount",
        "speedDeviationPct",
        "trailingOffRatio",
        "pitchRangeSt",
    }


@pytest.mark.parametrize("speeches", [[], [None], [{}], [answer_metrics(60_000)]])
def test_session_missing_metrics_are_null(speeches: list[dict[str, object] | None]) -> None:
    assert all(value is None for value in aggregate_speech_metrics(speeches).values())


def test_session_zero_metrics_are_preserved() -> None:
    metrics = aggregate_speech_metrics(
        [
            answer_metrics(
                60_000,
                fillerCount=0,
                longPauseCount=0,
                syllablesPerMin=0,
                trailingOffRatio=0,
                pitchRangeSt=0,
            )
        ]
    )
    assert metrics == {
        "fillerPerMin": 0.0,
        "longPauseCount": 0,
        "speedDeviationPct": -100.0,
        "trailingOffRatio": 0.0,
        "pitchRangeSt": 0.0,
    }


def test_session_filler_rate_uses_matching_counts_and_durations() -> None:
    metrics = aggregate_speech_metrics(
        [
            answer_metrics(60_000, fillerCount=2),
            answer_metrics(60_000, fillerCount=None),
            answer_metrics(None, fillerCount=100),
            answer_metrics(0, fillerCount=100),
        ]
    )
    assert metrics["fillerPerMin"] == 2.0


def test_session_pause_sum_does_not_require_duration_or_numeric_column_limit() -> None:
    metrics = aggregate_speech_metrics(
        [
            answer_metrics(None, longPauseCount=1000),
            answer_metrics(0, longPauseCount=2),
            None,
        ]
    )
    assert metrics["longPauseCount"] == 1002
    assert metrics["fillerPerMin"] is None


@pytest.mark.parametrize("duration", [None, 0])
def test_session_rates_without_positive_duration_are_null(duration: int | None) -> None:
    metrics = aggregate_speech_metrics(
        [
            answer_metrics(
                duration, fillerCount=2, syllablesPerMin=300, trailingOffRatio=10, pitchRangeSt=6
            )
        ]
    )
    assert all(value is None for value in metrics.values())


def test_session_voice_metrics_use_separate_weighted_denominators() -> None:
    metrics = aggregate_speech_metrics(
        [
            answer_metrics(60_000, trailingOffRatio=10, pitchRangeSt=4.125),
            answer_metrics(30_000, trailingOffRatio=20, pitchRangeSt=None),
            answer_metrics(None, trailingOffRatio=100, pitchRangeSt=100),
        ]
    )
    assert metrics["trailingOffRatio"] == 13.33
    assert metrics["pitchRangeSt"] == 4.13


def test_session_speed_deviation_uses_duration_weighted_speed() -> None:
    metrics = aggregate_speech_metrics(
        [
            answer_metrics(30_000, syllablesPerMin=310),
            answer_metrics(10_000, syllablesPerMin=250),
            answer_metrics(60_000, syllablesPerMin=None),
        ]
    )
    assert metrics["speedDeviationPct"] == 11.32


@pytest.mark.parametrize(
    ("speed", "expected"), [(265, 0.0), (250, -5.66), (0, -100.0), (3000, None)]
)
def test_session_speed_deviation_reference_sign_and_range(
    speed: int, expected: float | None
) -> None:
    assert (
        aggregate_speech_metrics([answer_metrics(60_000, syllablesPerMin=speed)])[
            "speedDeviationPct"
        ]
        == expected
    )


def test_session_speed_deviation_does_not_round_intermediate_average() -> None:
    """평균 265.0133의 편차는 0.005…이므로 중간 반올림 없이 0.01로 계산해야 한다."""
    metrics = aggregate_speech_metrics(
        [
            answer_metrics(9867, syllablesPerMin=265),
            answer_metrics(133, syllablesPerMin=266),
        ]
    )
    assert metrics["speedDeviationPct"] == 0.01


def test_session_final_values_round_half_up() -> None:
    metrics = aggregate_speech_metrics([answer_metrics(480_000, fillerCount=1, pitchRangeSt=2.675)])
    assert metrics["fillerPerMin"] == 0.13
    assert metrics["pitchRangeSt"] == 2.68


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (999.99, 999.99),
        (999.994, 999.99),
        (999.995, None),
        (1000, None),
    ],
)
def test_session_column_range_is_checked_after_rounding(
    value: float, expected: float | None
) -> None:
    assert (
        aggregate_speech_metrics([answer_metrics(60_000, pitchRangeSt=value)])["pitchRangeSt"]
        == expected
    )


def test_session_overflow_clears_only_affected_metric(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING", logger="app.interview.speech"):
        metrics = aggregate_speech_metrics(
            [answer_metrics(60, fillerCount=1, longPauseCount=2, pitchRangeSt=6)]
        )
    assert metrics["fillerPerMin"] is None
    assert metrics["longPauseCount"] == 2
    assert metrics["pitchRangeSt"] == 6.0
    assert "fillerPerMin" in caplog.text


def test_pause_touching_stt_gap_is_not_long_pause_and_not_speaking_time() -> None:
    """AI 명세 3장: 끊긴 구간과 겹치는 쉼은 긴 멈춤으로 집계하지 않고 발화 시간에서도 제외한다."""
    tokens = [tok("캐시를", 0, 500), tok(" 도입한", 6_000, 6_500), tok(" 이유는", 9_000, 9_500)]
    metrics = speech_metrics(tokens, (SttGap(1_000, 5_000),))
    assert metrics is not None
    # 500~6000 쉼은 끊긴 구간과 겹치므로 제외하고, 6500~9000 쉼은 그대로 긴 멈춤이다
    assert metrics["longPauseCount"] == 1
    assert metrics["speakingMs"] == 9_500 - 5_500 - 2_500


def test_gap_outside_answer_words_changes_nothing() -> None:
    tokens = [tok("캐시를", 1_000, 1_500), tok(" 도입한", 4_000, 4_500)]
    assert speech_metrics(tokens, (SttGap(0, 500),)) == speech_metrics(tokens)
