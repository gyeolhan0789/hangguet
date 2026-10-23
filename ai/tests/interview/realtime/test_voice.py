"""실시간 음성으로 계산하는 말끝 흐림 비율·억양 폭.

합성한 음성으로 계산식을 확인한다.
"""

import math

import numpy as np
import pytest

from app.common.answer import SpeechToken, VoiceMetrics
from app.interview.realtime import voice
from app.interview.realtime.voice import (
    MAX_PITCH_HZ,
    MIN_PITCH_HZ,
    TRAILING_DROP_DB,
    pcm16_samples,
    voice_metrics,
)

RATE = 16_000


def tone(seconds: float, hz: float, amplitude: float = 0.5) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    return amplitude * np.sin(2 * math.pi * hz * t)


def sweep(seconds: float, start_hz: float, end_hz: float) -> np.ndarray:
    """음 높이가 start_hz에서 end_hz까지 지수적으로 변하는 음성."""
    t = np.arange(int(seconds * RATE)) / RATE
    ratio = end_hz / start_hz
    phase = 2 * math.pi * start_hz * seconds / math.log(ratio) * (ratio ** (t / seconds) - 1)
    return 0.5 * np.sin(phase)


# 한 문장 두 단어: 0~500ms 「정말」, 500~1000ms 「좋았습니다.」
SENTENCE = (SpeechToken("정말", 0, 500), SpeechToken(" 좋았습니다.", 500, 1000))


def test_last_word_quieter_than_sentence_is_trailing_off() -> None:
    """마지막 어절이 문장 평균보다 6dB 이상 작으면 흐린 문장이다(AI 명세 3장)."""
    samples = np.concatenate([tone(0.5, 150, 0.5), tone(0.5, 150, 0.05)])

    metrics = voice_metrics(samples, RATE, SENTENCE)

    assert metrics.trailing_off_ratio == 100.0


def test_even_loudness_is_not_trailing_off() -> None:
    samples = tone(1.0, 150, 0.5)

    assert voice_metrics(samples, RATE, SENTENCE).trailing_off_ratio == 0.0


def test_trailing_off_boundary_is_6db() -> None:
    """6dB 바로 아래는 흐린 문장이 아니고 바로 위는 흐린 문장이다(AI 명세 3장)."""
    results = []
    # 0.19는 문장 평균과의 차이가 약 5.98dB, 0.185는 약 6.18dB다
    for quiet in (0.19, 0.185):
        samples = np.concatenate([tone(0.5, 150, 0.5), tone(0.5, 150, quiet)])
        whole = 10 * math.log10(float(np.mean(samples**2)))
        last = 10 * math.log10(float(np.mean(samples[RATE // 2 :] ** 2)))
        trailing = voice_metrics(samples, RATE, SENTENCE).trailing_off_ratio == 100.0
        results.append((whole - last >= TRAILING_DROP_DB, trailing))

    assert all(expected == actual for expected, actual in results)
    assert {expected for expected, _ in results} == {True, False}


def test_exactly_6db_quieter_last_word_is_trailing_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """AI 명세 3장은 「6dB 이상 낮으면」 흐린 문장이므로 정확히 6dB도 포함한다.

    합성 음성으로는 정확히 6dB를 만들 수 없어 음량 계산만 대역으로 바꾼다.
    """
    # 문장 전체(1초)는 -20dB, 마지막 어절(0.5초)은 정확히 6dB 낮은 -26dB로 계산한다
    monkeypatch.setattr(
        voice, "_level_db", lambda segment: -20.0 if segment.size > RATE // 2 else -26.0
    )

    assert voice_metrics(tone(1.0, 150), RATE, SENTENCE).trailing_off_ratio == 100.0


def test_ratio_counts_sentences() -> None:
    """흐린 문장 수 ÷ 문장 수 × 100.

    종결어미 없이 끝난 마지막 부분도 문장으로 집계한다.
    """
    tokens = (
        *SENTENCE,
        SpeechToken(" 그리고", 1000, 1500),
        SpeechToken(" 배웠습니다.", 1500, 2000),
        SpeechToken(" 그래서", 2000, 2500),
        SpeechToken(" 음", 2500, 3000),
    )
    samples = np.concatenate(
        [
            tone(0.5, 150, 0.5),
            tone(0.5, 150, 0.05),  # 1번 문장 흐림
            tone(1.0, 150, 0.5),  # 2번 문장 고름
            tone(0.5, 150, 0.5),
            tone(0.5, 150, 0.5),  # 3번(종결어미 없음) 고름
        ]
    )

    assert voice_metrics(samples, RATE, tokens).trailing_off_ratio == 33.33


def test_sentence_beyond_received_audio_is_not_judged() -> None:
    tokens = (*SENTENCE, SpeechToken(" 끝입니다.", 5000, 5500))
    samples = np.concatenate([tone(0.5, 150, 0.5), tone(0.5, 150, 0.05)])

    assert voice_metrics(samples, RATE, tokens).trailing_off_ratio == 100.0


def test_steady_pitch_has_almost_no_range() -> None:
    metrics = voice_metrics(tone(1.0, 150), RATE, SENTENCE)

    assert metrics.pitch_range_st is not None
    assert metrics.pitch_range_st < 0.5


def test_pitch_range_follows_percentiles_in_semitones() -> None:
    """한 옥타브(12반음)를 고르게 오르면 하위 5%·상위 95% 사이는 약 10.8반음이다."""
    samples = sweep(1.0, 120, 240)

    metrics = voice_metrics(samples, RATE, SENTENCE)

    expected = 12 * 0.9
    assert metrics.pitch_range_st == pytest.approx(expected, abs=0.6)


def test_pitch_is_measured_only_inside_words() -> None:
    """단어 밖 구간(휴지)의 소리는 억양 폭에 포함하지 않는다."""
    samples = np.concatenate([tone(1.0, 150), tone(1.0, 300)])

    metrics = voice_metrics(samples, RATE, SENTENCE)

    assert metrics.pitch_range_st is not None
    assert metrics.pitch_range_st < 0.5


@pytest.mark.parametrize("hz", [MIN_PITCH_HZ + 5, MAX_PITCH_HZ - 20])
def test_pitch_inside_range_is_detected(hz: float) -> None:
    assert voice_metrics(tone(1.0, hz), RATE, SENTENCE).pitch_range_st is not None


def test_silence_has_no_pitch_range() -> None:
    metrics = voice_metrics(np.zeros(RATE), RATE, SENTENCE)

    assert metrics.pitch_range_st is None


def test_quiet_frames_are_excluded_from_pitch() -> None:
    """음량이 정적 기준(-50dBFS)보다 작은 창은 주기가 뚜렷해도 음 높이에서 제외한다."""
    # 뒤 0.5초는 약 -57dBFS의 300Hz다.
    # 포함하면 150Hz와 섞여 억양 폭이 약 12반음이 된다
    samples = np.concatenate([tone(0.5, 150, 0.5), tone(0.5, 300, 0.002)])

    metrics = voice_metrics(samples, RATE, SENTENCE)

    assert metrics.pitch_range_st is not None
    assert metrics.pitch_range_st < 1.0


def test_noise_has_no_pitch_range() -> None:
    noise = np.random.default_rng(7).normal(0, 0.3, RATE)

    assert voice_metrics(noise, RATE, SENTENCE).pitch_range_st is None


def test_too_few_voiced_frames_has_no_pitch_range() -> None:
    """유성음이 0.2초보다 짧으면 백분위가 몇 개 창에 좌우되므로 구하지 않는다."""
    tokens = (SpeechToken("네.", 0, 150),)

    assert voice_metrics(tone(0.15, 150), RATE, tokens).pitch_range_st is None


@pytest.mark.parametrize("tokens", [None, ()])
def test_without_tokens_both_metrics_are_empty(tokens: tuple[SpeechToken, ...] | None) -> None:
    assert voice_metrics(tone(1.0, 150), RATE, tokens) == VoiceMetrics(None, None)


def test_without_audio_both_metrics_are_empty() -> None:
    assert voice_metrics(np.zeros(0), RATE, SENTENCE) == VoiceMetrics(None, None)


def test_pcm16_is_converted_to_unit_range() -> None:
    pcm = np.array([0, 16384, -32768, 32767], dtype="<i2").tobytes()

    assert pcm16_samples(pcm).tolist() == [0.0, 0.5, -1.0, 32767 / 32768]
