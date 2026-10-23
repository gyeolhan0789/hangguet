"""답변 토큰(answers.tokens)으로 말하기 지표를 계산한다.

기준: AI 명세 3장 말하기 분석, API 명세 5.11 문장 끝.
SCORE_ANSWER 작업자가 호출하는 순수 함수다. 말끝 흐림·억양 폭(음성 파일)은 처리하지 않는다.
"""

import re
from dataclasses import dataclass
from typing import Any, TypedDict

# AI 명세 3장: 망설임 소리(같은 글자를 늘인 것 포함)는 항상 집계한다
_HESITATION = re.compile(r"^(?:음+|어+|아+|에+|으+|흠+)$")
# AI 명세 3장: 담화 표지는 단어 끝에 쉼표·마침표·말줄임표가 붙어 단독으로 끊길 때만 집계한다
_DISCOURSE_MARKERS = frozenset(
    {"그", "저", "이제", "뭐", "막", "약간", "좀", "그냥", "그러니까", "이렇게", "뭔가"}
)
_MARKS = re.compile(r"[.,?!…]+")
_CUT_OFF = re.compile(r"[,.…]$")
# API 명세 5.11 문장 끝: 마침표·물음표·느낌표·말줄임표와 공백을 제외한 글이
# 종결어미로 끝나면 문장 끝, 쉼표로 끝나면 아님
_TRAILING = re.compile(r"[.?!…\s]+$")
_SENTENCE_ENDINGS = frozenset({"다", "요", "까", "죠"})
_HANGUL_SYLLABLE = re.compile(r"[가-힣]")

# AI 명세 3장: 문장 중간 2초 이상이면 긴 멈춤
LONG_PAUSE_MS = 2_000

# speech_metrics 컬럼 NUMERIC(5, 2)의 소수 자리(BE V1 마이그레이션).
# 답변별 음성 지표와 면접 단위 집계가 같은 컬럼에 저장되므로 두 계산이 이 값 하나를 사용한다
METRIC_DIGITS = 2


class SpeechMetrics(TypedDict):
    """answers.evaluation.speech 중 토큰으로 계산하는 키(AI 명세 3장)."""

    fillerCount: int
    speakingMs: int
    longPauseCount: int
    syllablesPerMin: int | None


@dataclass(frozen=True)
class Word:
    text: str
    start_ms: int
    end_ms: int


def group_words(tokens: list[dict[str, Any]]) -> list[Word]:
    """토큰 글자를 이어 붙이고 공백을 경계로 단어를 묶는다.

    Soniox는 한 단어를 여러 토큰으로 나눠 전송한다(예: "시간을" → "시간", "을").
    새 단어의 시작은 토큰 앞의 공백(" 응답")이나 공백만 있는 토큰(" ")으로 표시된다.
    두 경우 모두 단어 경계로 간주한다.
    단어 시각은 첫 토큰의 startMs부터 마지막 토큰의 endMs까지다.
    """
    words: list[Word] = []
    text, start, end = "", 0, 0
    for token in tokens:
        piece = str(token["text"])
        if piece[:1].isspace() and text:
            words.append(Word(text, start, end))
            text = ""
        body = piece.strip()
        if not body:
            continue
        if not text:
            start = int(token["startMs"])
        text += body
        end = int(token["endMs"])
        if piece[-1:].isspace():
            words.append(Word(text, start, end))
            text = ""
    if text:
        words.append(Word(text, start, end))
    return words


def is_filler(word: str) -> bool:
    core = _MARKS.sub("", word)
    if _HESITATION.match(core):
        return True
    return core in _DISCOURSE_MARKERS and bool(_CUT_OFF.search(word))


def ends_sentence(word: str) -> bool:
    body = _TRAILING.sub("", word)
    return body[-1:] in _SENTENCE_ENDINGS


def speech_metrics(tokens: list[dict[str, Any]] | None) -> SpeechMetrics | None:
    """tokens가 없거나 단어가 없으면 None(지표를 계산하지 않는다)."""
    words = group_words(tokens or [])
    if not words:
        return None
    pauses = [
        nxt.start_ms - cur.end_ms
        for cur, nxt in zip(words, words[1:], strict=False)
        if nxt.start_ms - cur.end_ms >= LONG_PAUSE_MS and not ends_sentence(cur.text)
    ]
    speaking_ms = max(0, words[-1].end_ms - words[0].start_ms - sum(pauses))
    syllables = sum(len(_HANGUL_SYLLABLE.findall(w.text)) for w in words)
    return {
        "fillerCount": sum(1 for w in words if is_filler(w.text)),
        "speakingMs": speaking_ms,
        "longPauseCount": len(pauses),
        # 정수로 반올림한다(.5는 올림). 내장 round()는 .5를 짝수 방향으로 반올림한다(312.5 → 312).
        "syllablesPerMin": (syllables * 120_000 + speaking_ms) // (2 * speaking_ms)
        if speaking_ms > 0
        else None,
    }
