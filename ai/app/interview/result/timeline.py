"""다시보기 타임라인 곡선과 낮은 체크포인트를 계산한다(AI 명세 4장 다시보기 타임라인).

- 곡선은 인상(6항목 평균)과 말끝 흐림·군말 횟수, 긴 멈춤 시간을 1초마다 구해 합친다.
  단위가 다른 값을 함께 보도록 각 값을 면접 전체의 평균·표준편차로 표준화한 뒤 가중 평균하고,
  그 값을 다시 면접 전체로 표준화한다. 0이 그 면접의 평균이다.
- 음성 3개는 많을수록 나쁘므로 부호를 뒤집는다.
- 인상 1/3, 긴 멈춤 1/3, 말끝 흐림·군말 각 1/6로 합친다.
  긴 멈춤은 횟수가 적어 1/6로는 한 번 멈춘 곳이 곡선에 드러나지 않았다.
- 체크포인트는 곡선이 LOW_LIMIT 이하로 이어진 구간마다 가장 낮은 1초다.
- 수치는 모두 임시 값이며 실제 면접으로 조정한다.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.common.answer import SpeechToken, TimelineInput
from app.common.rounding import round_half_up_float
from app.interview.speech import LONG_PAUSE_MS, ends_sentence, group_words, is_filler

STEP_MS = 1_000
# 얼굴로 볼 기준(AI 명세 6.6). 이보다 낮은 사진은 인상에서 뺀다
FACE_LIMIT = 0.5
# 음성 사건을 세는 앞뒤 범위이자 체크포인트 이유를 보는 범위
WINDOW_MS = 5_000
IMPRESSION_WEIGHT = 1 / 3
# 곡선이 이 값 이하면 평소보다 유난히 낮다
LOW_LIMIT = -1.5
# 체크포인트 사이 최소 간격
MIN_GAP_MS = 10_000
# 이유로 보는 표준화 값
REASON_LIMIT = -1.0
VALUE_DIGITS = 2


class Metric(StrEnum):
    """체크포인트 이유(AI 명세 4장 reasons.metric)."""

    STABILITY = "STABILITY"
    CONFIDENCE = "CONFIDENCE"
    EXPRESSION = "EXPRESSION"
    EMOTION = "EMOTION"
    LIKEABILITY = "LIKEABILITY"
    TRUST = "TRUST"
    TRAILING_OFF = "TRAILING_OFF"
    FILLER = "FILLER"
    LONG_PAUSE = "LONG_PAUSE"


# AI 명세 6.6 impressions.items 키 → 이유
IMPRESSION_METRICS: Mapping[str, Metric] = {
    "stability": Metric.STABILITY,
    "confidence": Metric.CONFIDENCE,
    "expression": Metric.EXPRESSION,
    "emotion": Metric.EMOTION,
    "likeability": Metric.LIKEABILITY,
    "trust": Metric.TRUST,
}
VOICE_METRICS = (Metric.TRAILING_OFF, Metric.FILLER, Metric.LONG_PAUSE)
VOICE_WEIGHTS: Mapping[Metric, float] = {
    Metric.TRAILING_OFF: 1 / 6,
    Metric.FILLER: 1 / 6,
    Metric.LONG_PAUSE: 1 / 3,
}


@dataclass(frozen=True)
class TimelineAnswer:
    answer_id: int
    tokens: tuple[SpeechToken, ...] | None
    timeline: TimelineInput | None


@dataclass(frozen=True)
class Reason:
    metric: Metric
    # 음성 이유의 앞뒤 5초 횟수. 인상이면 None
    count: int | None


@dataclass(frozen=True)
class Checkpoint:
    at_ms: int
    start_ms: int
    end_ms: int
    value: float
    reasons: tuple[Reason, ...]


@dataclass(frozen=True)
class AnswerTimeline:
    answer_id: int
    # (답변 시작 기준 밀리초, 표준화 값). 값을 구하지 못한 1초는 없다
    points: tuple[tuple[int, float], ...]
    checkpoints: tuple[Checkpoint, ...]


@dataclass
class _Second:
    """답변 하나의 1초. 구하지 못한 값은 None이다."""

    impression: float | None = None
    # 인상 6항목 각각(이유를 고를 때 쓴다)
    items: dict[str, float] = field(default_factory=dict)
    # 음성 사건 횟수(이유에 표시한다)
    counts: dict[Metric, int | None] = field(default_factory=dict)
    # 곡선에 쓰는 음성 값. 긴 멈춤은 멈춘 초, 나머지는 횟수다
    amounts: dict[Metric, float | None] = field(default_factory=dict)


def _events(answer: TimelineAnswer) -> dict[Metric, list[tuple[int, float]] | None]:
    """음성 사건마다 (답변 시작 기준 밀리초, 곡선 값). 구할 수 없는 사건은 None이다."""
    trailing = None
    if answer.timeline is not None and answer.timeline.trailing_off_at_ms is not None:
        trailing = [(at, 1.0) for at in answer.timeline.trailing_off_at_ms]
    if answer.tokens is None:
        return {Metric.TRAILING_OFF: trailing, Metric.FILLER: None, Metric.LONG_PAUSE: None}
    words = group_words([token.to_json() for token in answer.tokens])
    # AI 명세 3장: 문장 중간에서 앞 단어 끝부터 다음 단어 시작까지 2초 이상이면 긴 멈춤.
    # 오래 멈출수록 곡선이 더 내려가도록 멈춘 초를 값으로 쓴다
    pauses = [
        (cur.end_ms, (nxt.start_ms - cur.end_ms) / STEP_MS)
        for cur, nxt in zip(words, words[1:], strict=False)
        if nxt.start_ms - cur.end_ms >= LONG_PAUSE_MS and not ends_sentence(cur.text)
    ]
    return {
        Metric.TRAILING_OFF: trailing,
        Metric.FILLER: [(word.start_ms, 1.0) for word in words if is_filler(word.text)],
        Metric.LONG_PAUSE: pauses,
    }


def _end_ms(answer: TimelineAnswer) -> int | None:
    ends = [token.end_ms for token in answer.tokens or ()]
    if answer.timeline is not None:
        ends += list(answer.timeline.trailing_off_at_ms or ())
        ends += [sample.at_ms for sample in answer.timeline.impressions or ()]
    return max(ends) if ends else None


def _seconds(answer: TimelineAnswer) -> list[_Second]:
    end = _end_ms(answer)
    if end is None:
        return []
    seconds = [_Second() for _ in range(end // STEP_MS + 1)]
    samples = answer.timeline.impressions if answer.timeline is not None else None
    by_second: dict[int, list[dict[str, float]]] = {}
    for sample in samples or ():
        scores = {key: score for key, score in sample.scores.items() if score is not None}
        if sample.face >= FACE_LIMIT and scores:
            by_second.setdefault(sample.at_ms // STEP_MS, []).append(scores)
    for index, found in by_second.items():
        second = seconds[index]
        second.impression = _mean([_mean(list(scores.values())) for scores in found])
        for key in IMPRESSION_METRICS:
            values = [scores[key] for scores in found if key in scores]
            if values:
                second.items[key] = _mean(values)
    events = _events(answer)
    for index, second in enumerate(seconds):
        center = index * STEP_MS
        for metric in VOICE_METRICS:
            happened = events[metric]
            if happened is None:
                second.counts[metric] = second.amounts[metric] = None
                continue
            near = [amount for t, amount in happened if abs(t - center) <= WINDOW_MS]
            second.counts[metric] = len(near)
            second.amounts[metric] = sum(near)
    return seconds


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)


@dataclass(frozen=True)
class _Scale:
    mean: float
    sd: float

    def z(self, value: float) -> float:
        return 0.0 if self.sd == 0 else (value - self.mean) / self.sd


def _scale(values: Sequence[float]) -> _Scale | None:
    if not values:
        return None
    mean = _mean(values)
    return _Scale(mean, math.sqrt(_mean([(v - mean) ** 2 for v in values])))


def build_timelines(answers: Sequence[TimelineAnswer]) -> dict[int, AnswerTimeline]:
    """답변마다 곡선과 낮은 체크포인트. 구할 값이 하나도 없는 답변은 결과에 없다."""
    seconds = {answer.answer_id: _seconds(answer) for answer in answers}
    pooled = [second for found in seconds.values() for second in found]
    impression = _scale([s.impression for s in pooled if s.impression is not None])
    items = {
        key: _scale([s.items[key] for s in pooled if key in s.items]) for key in IMPRESSION_METRICS
    }
    voice = {
        metric: _scale([a for s in pooled if (a := s.amounts.get(metric)) is not None])
        for metric in VOICE_METRICS
    }

    def composite(second: _Second) -> float | None:
        parts: list[tuple[float, float]] = []
        if second.impression is not None and impression is not None:
            parts.append((IMPRESSION_WEIGHT, impression.z(second.impression)))
        for metric in VOICE_METRICS:
            amount = second.amounts.get(metric)
            scale = voice[metric]
            if amount is not None and scale is not None:
                parts.append((VOICE_WEIGHTS[metric], -scale.z(amount)))
        if not parts:
            return None
        return sum(w * z for w, z in parts) / sum(w for w, _ in parts)

    raw = {aid: [composite(second) for second in found] for aid, found in seconds.items()}
    overall = _scale([v for values in raw.values() for v in values if v is not None])
    if overall is None:
        return {}

    def reasons(found: list[_Second], index: int) -> tuple[Reason, ...]:
        window = found[max(0, index - WINDOW_MS // STEP_MS) : index + WINDOW_MS // STEP_MS + 1]
        scored: list[tuple[float, Reason]] = []
        for key, metric in IMPRESSION_METRICS.items():
            scale = items[key]
            values = [s.items[key] for s in window if key in s.items]
            if scale is not None and values:
                scored.append((_mean([scale.z(v) for v in values]), Reason(metric, None)))
        for metric in VOICE_METRICS:
            count = found[index].counts.get(metric)
            amount = found[index].amounts.get(metric)
            scale = voice[metric]
            # 일어나지 않은 음성 사건은 이유가 될 수 없다
            if count and amount is not None and scale is not None:
                scored.append((-scale.z(amount), Reason(metric, count)))
        chosen = sorted(
            (item for item in scored if item[0] <= REASON_LIMIT), key=lambda item: item[0]
        )
        if not chosen and scored:
            chosen = [min(scored, key=lambda item: item[0])]
        return tuple(reason for _, reason in chosen)

    timelines = {}
    for answer in answers:
        found = seconds[answer.answer_id]
        values = [None if v is None else overall.z(v) for v in raw[answer.answer_id]]
        points = tuple(
            (index * STEP_MS, round_half_up_float(v, VALUE_DIGITS))
            for index, v in enumerate(values)
            if v is not None
        )
        if not points:
            continue
        candidates: list[tuple[float, int, int, int]] = []
        start: int | None = None
        for index, v in enumerate([*values, None]):
            if v is not None and v <= LOW_LIMIT:
                start = index if start is None else start
                continue
            if start is not None:
                run = range(start, index)
                lowest = min(run, key=lambda i: values[i] or 0.0)
                candidates.append((values[lowest] or 0.0, lowest, start, index - 1))
                start = None
        chosen: list[tuple[float, int, int, int]] = []
        for candidate in sorted(candidates):
            if all(abs(candidate[1] - c[1]) * STEP_MS >= MIN_GAP_MS for c in chosen):
                chosen.append(candidate)
        checkpoints = tuple(
            Checkpoint(
                at_ms=lowest * STEP_MS,
                start_ms=first * STEP_MS,
                end_ms=last * STEP_MS,
                value=round_half_up_float(value, VALUE_DIGITS),
                reasons=reasons(found, lowest),
            )
            for value, lowest, first, last in sorted(chosen, key=lambda c: c[1])
        )
        timelines[answer.answer_id] = AnswerTimeline(answer.answer_id, points, checkpoints)
    return timelines


def window_text(tokens: tuple[SpeechToken, ...] | None, at_ms: int) -> str:
    """체크포인트 앞뒤 5초에 말한 글(GMS 문구 입력, AI 명세 4장)."""
    words = group_words([token.to_json() for token in tokens or ()])
    return " ".join(w.text for w in words if abs(w.start_ms - at_ms) <= WINDOW_MS)


def timeline_json(
    timeline: AnswerTimeline, texts: Mapping[tuple[int, Metric], str]
) -> dict[str, Any]:
    """answers[].evaluation.timeline 값. texts는 (체크포인트 시각, 이유)별 보완할 점이다."""
    return {
        "points": [{"atMs": at, "value": value} for at, value in timeline.points],
        "checkpoints": [
            {
                "atMs": c.at_ms,
                "startMs": c.start_ms,
                "endMs": c.end_ms,
                "value": c.value,
                "reasons": [
                    {
                        "metric": r.metric.value,
                        "count": r.count,
                        "text": texts[(c.at_ms, r.metric)],
                    }
                    for r in c.reasons
                ],
            }
            for c in timeline.checkpoints
        ],
    }
