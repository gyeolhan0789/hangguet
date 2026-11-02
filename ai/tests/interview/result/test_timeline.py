"""다시보기 타임라인 곡선 · 낮은 체크포인트 시험(AI 명세 4장 다시보기 타임라인)."""

from app.common.answer import ImpressionSample, SpeechToken, TimelineInput
from app.interview.result.timeline import (
    LOW_LIMIT,
    MIN_GAP_MS,
    Metric,
    Reason,
    TimelineAnswer,
    build_timelines,
    timeline_json,
    window_text,
)

KEYS = ("stability", "confidence", "expression", "emotion", "likeability", "trust")


def sample(at_s: int, face: float = 0.9, **low: float) -> ImpressionSample:
    return ImpressionSample(
        at_ms=at_s * 1000, face=face, scores={key: low.get(key, 60.0) for key in KEYS}
    )


def impressions(
    seconds: int, dips: dict[int, dict[str, float]], face: float = 0.9
) -> TimelineAnswer:
    samples = tuple(
        sample(s, face if s in dips else 0.9, **dips.get(s, {})) for s in range(seconds)
    )
    return TimelineAnswer(1, None, TimelineInput(None, samples))


def test_low_impression_becomes_checkpoint_with_low_items_as_reasons() -> None:
    """6항목 평균이 평소보다 유난히 낮은 곳에 체크포인트를 두고, 낮았던 항목만 이유로 단다."""
    dips = {s: {"confidence": 10.0, "trust": 10.0} for s in range(30, 36)}

    found = build_timelines([impressions(60, dips)])[1]

    assert len(found.points) == 60
    assert len(found.checkpoints) == 1
    checkpoint = found.checkpoints[0]
    assert 30_000 <= checkpoint.at_ms <= 35_000
    assert (checkpoint.start_ms, checkpoint.end_ms) == (30_000, 35_000)
    assert checkpoint.value <= LOW_LIMIT
    assert set(checkpoint.reasons) == {
        Reason(Metric.CONFIDENCE, None),
        Reason(Metric.TRUST, None),
    }


def test_points_are_centered_on_interview_average() -> None:
    dips = {s: {"confidence": 10.0} for s in range(30, 36)}

    values = [value for _, value in build_timelines([impressions(60, dips)])[1].points]

    assert abs(sum(values) / len(values)) < 0.01
    assert max(values) > 0 > min(values)


def test_photos_that_are_not_faces_are_left_out() -> None:
    """얼굴 확률이 0.5 미만인 사진은 인상에서 뺀다(AI 명세 6.6)."""
    dips = {s: {"confidence": 10.0, "trust": 10.0} for s in range(30, 36)}

    found = build_timelines([impressions(60, dips, face=0.2)])[1]

    assert found.checkpoints == ()
    assert len(found.points) == 54


def word(text: str, at_s: float) -> SpeechToken:
    start = int(at_s * 1000)
    return SpeechToken(f" {text}", start, start + 300)


def test_fillers_lower_the_curve_and_are_counted_as_reason() -> None:
    """음성 사건은 많을수록 곡선을 낮추고, 앞뒤 5초 횟수를 이유에 단다."""
    tokens = tuple(word("음," if 40 <= s <= 43 else "말합니다", s) for s in range(60))
    answer = TimelineAnswer(1, tokens, TimelineInput(None, None))

    checkpoint = build_timelines([answer])[1].checkpoints[0]

    assert 38_000 <= checkpoint.at_ms <= 45_000
    assert checkpoint.reasons == (Reason(Metric.FILLER, 4),)


def test_trailing_off_and_long_pause_are_voice_events() -> None:
    tokens = (*(word("말하고", s) for s in range(20)), word("있습니다.", 20))
    answer = TimelineAnswer(1, tokens, TimelineInput((20_300,), None))

    found = build_timelines([answer])[1]

    assert found.points
    assert found.checkpoints[0].reasons[0].metric is Metric.TRAILING_OFF


def speech_with_pauses(seconds: int, pauses: dict[int, float]) -> tuple[SpeechToken, ...]:
    """1초마다 한 단어를 말하고, pauses의 초에 말한 단어 뒤에서 그 초만큼 더 멈춘다."""
    tokens, at = [], 0.0
    while at < seconds:
        tokens.append(word("말하고", at))
        at += 1 + pauses.get(int(at), 0)
    return tuple(tokens)


def test_one_long_pause_becomes_checkpoint() -> None:
    """한 번 멈춘 곳도 곡선에 드러난다. 인상이 조금씩 흔들려도 체크포인트가 된다."""
    tokens = speech_with_pauses(60, {30: 3})
    samples = tuple(sample(s, **dict.fromkeys(KEYS, 60.0 + s * 3 % 7 * 2)) for s in range(63))
    answer = TimelineAnswer(1, tokens, TimelineInput(None, samples))

    found = build_timelines([answer])[1]

    assert len(found.checkpoints) == 1
    assert 25_000 <= found.checkpoints[0].at_ms <= 36_000
    assert found.checkpoints[0].reasons == (Reason(Metric.LONG_PAUSE, 1),)


def test_longer_pause_lowers_the_curve_more() -> None:
    tokens = speech_with_pauses(70, {15: 2, 50: 5})
    found = build_timelines([TimelineAnswer(1, tokens, TimelineInput(None, None))])[1]
    points = dict(found.points)

    def lowest(at_ms: int) -> float:
        return min(v for t, v in points.items() if abs(t - at_ms) <= 5_000)

    assert lowest(53_000) < lowest(16_000) < 0


def test_close_dips_keep_only_the_lower_one() -> None:
    dips = {s: {"confidence": 20.0} for s in (20, 21)} | {
        s: {"confidence": 0.0, "trust": 0.0} for s in (27, 28)
    }

    checkpoints = build_timelines([impressions(60, dips)])[1].checkpoints

    assert len(checkpoints) == 1
    assert checkpoints[0].at_ms in (27_000, 28_000)
    assert MIN_GAP_MS == 10_000


def test_standardized_over_whole_interview() -> None:
    """평소는 답변 하나가 아니라 면접 전체다. 다른 답변보다 내내 낮은 답변이 낮게 나온다."""
    low = TimelineAnswer(
        2, None, TimelineInput(None, tuple(sample(s, confidence=10.0) for s in range(30)))
    )

    found = build_timelines([impressions(30, {}), low])

    assert all(value < 0 for _, value in found[2].points)
    assert all(value > 0 for _, value in found[1].points)


def test_answer_without_values_has_no_timeline() -> None:
    assert build_timelines([TimelineAnswer(1, None, None)]) == {}
    assert build_timelines([TimelineAnswer(1, None, TimelineInput(None, ()))]) == {}


def test_json_has_points_checkpoints_and_reason_texts() -> None:
    dips = {s: {"confidence": 10.0} for s in range(30, 36)}
    found = build_timelines([impressions(60, dips)])[1]
    at = found.checkpoints[0].at_ms

    result = timeline_json(found, {(at, Metric.CONFIDENCE): "고개를 드세요."})

    assert result["points"][0] == {"atMs": 0, "value": found.points[0][1]}
    assert result["checkpoints"] == [
        {
            "atMs": at,
            "startMs": 30_000,
            "endMs": 35_000,
            "value": found.checkpoints[0].value,
            "reasons": [{"metric": "CONFIDENCE", "count": None, "text": "고개를 드세요."}],
        }
    ]


def test_window_text_is_words_within_five_seconds() -> None:
    tokens = (word("처음", 0), word("가운데", 10), word("끝", 20))

    assert window_text(tokens, 12_000) == "가운데"
    assert window_text(None, 0) == ""
