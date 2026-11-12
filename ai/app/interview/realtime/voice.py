"""면접 에이전트가 답변을 듣는 동안 수신한 음성으로 말끝 흐림 비율과 억양 폭을 계산한다.

기준: AI 명세 3장 말하기 지표 표(trailingOffRatio·pitchRangeSt), 6.2 answer.completed speech.
Egress는 면접 전체를 트랙 단위로 녹화해 답변별 음성 파일이 없으므로,
STT로 전송하는 것과 같은 음성을 답변 동안 수집해 답변이 끝날 때 한 번 계산한다.
- 시각 기준은 tokens와 같은 답변 스트림 시작(0ms, answerStartedAt)이다.
  음성의 첫 표본이 0ms다.
- 단어 시각과 문장 경계는 토큰 기반 지표와 같은 규칙(app.interview.speech)을 사용한다.
  두 지표가 같은 단어·문장을 대상으로 하도록 하기 위함이다.
- 구하지 못한 지표는 None이다.
  판정은 비어 있는 지표를 빼고 진행한다(AI 명세 3장).
"""

import math
from collections.abc import Sequence
from decimal import Decimal

import numpy as np
import numpy.typing as npt

from app.common.answer import SpeechToken, VoiceMetrics
from app.common.rounding import round_half_up_float
from app.interview.speech import METRIC_DIGITS, Word, ends_sentence, group_words

# AI 명세 3장: 마지막 어절의 평균 음량이 문장 평균보다 이 값 이상 낮으면 흐린 문장이다
TRAILING_DROP_DB = 6.0
# AI 명세 3장: 음 높이 하위 5%·상위 95% 값으로 억양 폭(반음)을 계산한다
PITCH_PERCENTILES = (5.0, 95.0)

# 음 높이 추정 기준값은 Praat 설명서 pitch analysis by raw autocorrelation의 표준값이다.
# 필터 없는 같은 자기상관 방식이라 표준값을 그대로 적용할 수 있다
# 음 높이 범위(Hz).
# 범위 밖의 주기는 잡음이나 배음으로 보고 제외한다
MIN_PITCH_HZ = 75.0
MAX_PITCH_HZ = 600.0
# 분석 창(window/frame)과 간격(밀리초).
# 창은 가장 낮은 음 높이 주기 3개(3 ÷ 75Hz = 40ms), 간격은 0.75 ÷ 75Hz(10ms)로 Praat와 같다
FRAME_MS = 40
HOP_MS = 10
# 정규화 자기상관의 최댓값이 이 값 미만이면 주기가 뚜렷하지 않은 무성음·잡음으로 보고 제외한다
VOICING_THRESHOLD = 0.45
# 창 안의 최대 진폭이 답변 전체 최대 진폭의 이 비율 미만이면,
# 정적으로 보고 음 높이를 추정하지 않는다.
# 절대 음량 대신 비율을 사용해 마이크 음량이 달라도 같은 기준으로 판단한다.
# Praat는 이 값을 무성음 판단에 반영하지만, 여기서는 해당 창을 제외하는 방식으로 단순화한다
SILENCE_RATIO = 0.03
# 발화 구간(첫 단어 시작부터 마지막 단어 끝까지)이 이보다 짧으면 억양 폭을 구하지 않는다(밀리초).
# 장기 음 높이의 평균·중앙값이 안정되는 시간의 중앙값은 약 10초다.
# 출처는 Arantes & Eriksson, Speech Prosody 2014이다.
# 백분위 폭은 분포의 양 끝을 사용하므로 더 긴 시간이 필요할 수 있어,
# 실제 면접 음성으로 확인한 뒤 조정한다
MIN_PITCH_SPEECH_MS = 10_000

# 0을 log로 계산하지 않도록 더하는 아주 작은 값
_EPSILON = 1e-12

FloatArray = npt.NDArray[np.float64]


def pcm16_samples(pcm: bytes) -> FloatArray:
    """16비트 부호 있는 정수 PCM(리틀 엔디언)을 -1~1 실수 표본으로 변환한다."""
    return np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768.0


def _words(tokens: Sequence[SpeechToken]) -> list[Word]:
    return group_words([{"text": t.text, "startMs": t.start_ms, "endMs": t.end_ms} for t in tokens])


def _sentences(words: Sequence[Word]) -> list[list[Word]]:
    """종결어미로 끝나는 단어에서 문장을 나눈다.

    종결어미 없이 끝난 마지막 부분도 문장으로 본다.
    답변이 종결어미 없이 끝나는 경우도 말끝 흐림의 판단 대상이기 때문이다.
    """
    sentences: list[list[Word]] = []
    current: list[Word] = []
    for word in words:
        current.append(word)
        if ends_sentence(word.text):
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)
    return sentences


def _segment(samples: FloatArray, rate: int, start_ms: int, end_ms: int) -> FloatArray:
    start = start_ms * rate // 1000
    end = end_ms * rate // 1000
    return samples[start:end]


def _level_db(segment: FloatArray) -> float:
    return 10.0 * math.log10(float(np.mean(segment**2)) + _EPSILON)


def _trailing_judgments(
    samples: FloatArray, rate: int, words: Sequence[Word]
) -> list[tuple[int, bool]]:
    """판단한 문장마다 마지막 단어 끝 시각과 흐렸는지.

    음성이 없는 문장은 판단하지 않는다.
    """
    judgments = []
    for sentence in _sentences(words):
        whole = _segment(samples, rate, sentence[0].start_ms, sentence[-1].end_ms)
        last = _segment(samples, rate, sentence[-1].start_ms, sentence[-1].end_ms)
        # 토큰 시각이 수신한 음성 길이를 넘는 문장은 비교할 음성이 없다
        if whole.size == 0 or last.size == 0:
            continue
        trailing = _level_db(last) <= _level_db(whole) - TRAILING_DROP_DB
        judgments.append((sentence[-1].end_ms, trailing))
    return judgments


def trailing_off_ratio(samples: FloatArray, rate: int, words: Sequence[Word]) -> float | None:
    """흐린 문장 수 ÷ 문장 수 × 100(%)."""
    judgments = _trailing_judgments(samples, rate, words)
    if not judgments:
        return None
    trailing = sum(1 for _, trailed in judgments if trailed)
    return round_half_up_float(Decimal(trailing * 100) / len(judgments), METRIC_DIGITS)


def trailing_off_at_ms(
    samples: FloatArray, rate: int, tokens: Sequence[SpeechToken] | None
) -> tuple[int, ...] | None:
    """흐린 문장의 마지막 단어 끝 시각(밀리초, 시각 순).

    다시보기 타임라인용이다(AI 명세 3장 trailingOffAtMs).
    말끝 흐림 비율과 같은 문장을 판단하며, 비율을 구하지 못하면 None이다.
    """
    words = _words(tokens or ())
    if not words or samples.size == 0:
        return None
    judgments = _trailing_judgments(samples, rate, words)
    if not judgments:
        return None
    return tuple(end_ms for end_ms, trailed in judgments if trailed)


def _speech_mask(
    frame_count: int, hop: int, window: int, rate: int, words: Sequence[Word]
) -> npt.NDArray[np.bool_]:
    centers_ms = (np.arange(frame_count) * hop + window / 2) * 1000.0 / rate
    mask = np.zeros(frame_count, dtype=bool)
    for word in words:
        mask |= (centers_ms >= word.start_ms) & (centers_ms <= word.end_ms)
    return mask


def pitch_range_st(samples: FloatArray, rate: int, words: Sequence[Word]) -> float | None:
    """단어 구간의 유성음 창에서 추정한 음 높이로 12 × log2(상위 95% ÷ 하위 5%)를 계산한다(반음).

    음 높이는 창마다 정규화 자기상관이 가장 큰 주기로 추정한다.
    Praat의 자기상관 방식과 같은 원리이고 추가 라이브러리 없이 numpy로 계산할 수 있다.
    """
    if words[-1].end_ms - words[0].start_ms < MIN_PITCH_SPEECH_MS:
        return None
    window = rate * FRAME_MS // 1000
    hop = rate * HOP_MS // 1000
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if samples.size < window or peak <= 0.0:
        return None
    frames = np.lib.stride_tricks.sliding_window_view(samples, window)[::hop]
    loud = np.max(np.abs(frames), axis=1) >= SILENCE_RATIO * peak
    selected = frames[_speech_mask(len(frames), hop, window, rate, words) & loud]
    if len(selected) == 0:
        return None
    centered = selected - selected.mean(axis=1, keepdims=True)
    # 자기상관은 파워 스펙트럼의 역변환이다.
    # 순환 상관이 섞이지 않도록 창 길이의 두 배로 변환한다
    spectrum = np.fft.rfft(centered, n=2 * window, axis=1)
    autocorr = np.fft.irfft(np.abs(spectrum) ** 2, axis=1)[:, :window]
    min_lag = int(rate / MAX_PITCH_HZ)
    max_lag = min(int(rate / MIN_PITCH_HZ), window - 1)
    normalized = autocorr[:, min_lag : max_lag + 1] / (autocorr[:, :1] + _EPSILON)
    best = np.argmax(normalized, axis=1)
    voiced = normalized[np.arange(len(best)), best] >= VOICING_THRESHOLD
    if not voiced.any():
        return None
    pitch_hz = rate / (best[voiced] + min_lag)
    low, high = np.percentile(pitch_hz, PITCH_PERCENTILES)
    return round_half_up_float(12.0 * math.log2(float(high) / float(low)), METRIC_DIGITS)


def voice_metrics(
    samples: FloatArray, rate: int, tokens: Sequence[SpeechToken] | None
) -> VoiceMetrics:
    """답변 하나의 말끝 흐림 비율과 억양 폭.

    토큰이나 음성이 없으면 두 값 모두 None이다.
    """
    words = _words(tokens or ())
    if not words or samples.size == 0:
        return VoiceMetrics(trailing_off_ratio=None, pitch_range_st=None)
    return VoiceMetrics(
        trailing_off_ratio=trailing_off_ratio(samples, rate, words),
        pitch_range_st=pitch_range_st(samples, rate, words),
    )
