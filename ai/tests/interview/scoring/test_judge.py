import json
import logging
import math
from collections.abc import Mapping
from typing import Any

import pytest

from app.common.gms import GmsResult, TokenLogprob
from app.common.versions import REGISTRY, VersionKind
from app.interview.scoring.judge import (
    PROMPT_VERSION,
    Criterion,
    StructureBrokenError,
    build_judge_messages,
    level_probs,
    parse_judgement,
    score_judgements,
)
from app.interview.speech import LONG_PAUSE_MS

GOOD = {criterion.value: {"reason": "판정 근거", "level": 3} for criterion in Criterion}


def result(
    content: Mapping[str, Any] | None = None, tokens: list[TokenLogprob] | None = None
) -> GmsResult:
    return GmsResult(dict(GOOD if content is None else content), tokens, "test-model")


def response_tokens(
    missing: Criterion | None = None, reason: str = "판정 근거"
) -> list[TokenLogprob]:
    tokens = [TokenLogprob("{", 0, {})]
    for index, criterion in enumerate(Criterion):
        prefix = ("," if index else "") + json.dumps(criterion.value)
        prefix += ': {"reason": ' + json.dumps(reason) + ', "level":'
        top = {} if criterion is missing else {"1": math.log(0.1), "2": math.log(0.3)}
        if criterion is not missing:
            top.update({"3": math.log(0.4), " 3": math.log(0.2), "4": math.log(0.01)})
        tokens += [TokenLogprob(prefix, 0, {}), TokenLogprob(" 3", 0, top)]
        tokens.append(TokenLogprob("}", 0, {}))
    return tokens + [TokenLogprob("}", 0, {})]


def test_prompt_version_is_registered() -> None:
    assert REGISTRY.require(VersionKind.PROMPT, PROMPT_VERSION) == "score-answer-v1"


def test_prompt_uses_supplied_evidence_without_new_graduate_restriction() -> None:
    system, user = build_judge_messages("질문 원문", "채점 기준 원문", "답변 원문", None)
    assert "신입" not in system["content"]
    assert all(text in user["content"] for text in ("질문 원문", "채점 기준 원문", "답변 원문"))
    assert "말하기 지표" not in user["content"]


def test_prompt_includes_five_metrics_without_duration_or_gaze() -> None:
    speech = {
        "fillerCount": 0,
        "longPauseCount": 1,
        "syllablesPerMin": 310,
        "trailingOffRatio": 12.5,
        "pitchRangeSt": 6.2,
        "speakingMs": 41000,
        "gazeRatio": 80,
    }
    prompt = build_judge_messages("질문", "기준", "답변", speech)[1]["content"]
    assert "군말 수: 0" in prompt
    assert f"문장 중간 {LONG_PAUSE_MS / 1000:g}초 이상 멈춤 수: 1" in prompt
    assert "분당 음절 수: 310" in prompt
    assert "말끝 흐림 비율(%): 12.5" in prompt
    assert "억양 폭(반음): 6.2" in prompt
    assert "41000" not in prompt and "gazeRatio" not in prompt
    assert "DELIVERY 판정에만 사용" in prompt


@pytest.mark.parametrize("speech", [{}, {"pitchRangeSt": None}, {"speakingMs": 41000}])
def test_prompt_omits_unavailable_judging_metrics(speech: dict[str, object]) -> None:
    assert "말하기 지표" not in build_judge_messages("질문", "기준", "답변", speech)[1]["content"]


@pytest.mark.parametrize("level", [0, 4, True, 3.0, "3", None])
def test_invalid_level_is_structure_failure(level: Any) -> None:
    with pytest.raises(StructureBrokenError):
        parse_judgement(result({**GOOD, "LOGIC": {"level": level, "reason": "근거"}}))


@pytest.mark.parametrize("reason", [None, "", " \n", 3])
def test_invalid_reason_is_structure_failure(reason: Any) -> None:
    with pytest.raises(StructureBrokenError):
        parse_judgement(result({**GOOD, "LOGIC": {"level": 3, "reason": reason}}))


@pytest.mark.parametrize("criterion", list(Criterion))
def test_missing_criterion_is_structure_failure(criterion: Criterion) -> None:
    with pytest.raises(StructureBrokenError):
        parse_judgement(result({key: value for key, value in GOOD.items() if key != criterion}))


def test_non_object_criterion_is_structure_failure() -> None:
    with pytest.raises(StructureBrokenError):
        parse_judgement(result({**GOOD, "LOGIC": 3}))


def test_probabilities_are_merged_and_recorded_per_criterion() -> None:
    judged = parse_judgement(result(tokens=response_tokens()))
    assert judged[Criterion.LOGIC].probs == pytest.approx({1: 0.1, 2: 0.3, 3: 0.6})
    scored = score_judgements(judged)
    assert scored["LOGIC"] == {
        "level": 3,
        "score": 80,
        "scoreMethod": "PROBABILITY",
        "reason": "판정 근거",
    }
    assert all(item["scoreMethod"] == "PROBABILITY" for item in scored.values())


@pytest.mark.parametrize("missing", list(Criterion))
def test_only_missing_probability_uses_fixed_score(
    missing: Criterion, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="app.interview.scoring.judge"):
        scored = score_judgements(parse_judgement(result(tokens=response_tokens(missing))))
    assert scored[missing]["score"] == 90
    assert scored[missing]["scoreMethod"] == "FIXED"
    for criterion in Criterion:
        if criterion is not missing:
            assert scored[criterion]["score"] == 80
            assert scored[criterion]["scoreMethod"] == "PROBABILITY"
    assert len(caplog.records) == 1
    assert missing in caplog.records[0].getMessage()


def test_absent_probabilities_use_fixed_scores() -> None:
    scored = score_judgements(parse_judgement(result()))
    assert all(item["score"] == 90 and item["scoreMethod"] == "FIXED" for item in scored.values())


def test_json_keys_inside_reason_are_not_probability_positions() -> None:
    tokens = response_tokens(reason='"DELIVERY": {"level": 1}, "level": 2')
    head = TokenLogprob('<think>"JOB_FIT": {"level":1}</think>', 0, {"1": 0})
    assert level_probs([head, *tokens], Criterion.DELIVERY) == pytest.approx(
        {1: 0.1, 2: 0.3, 3: 0.6}
    )


@pytest.mark.parametrize("logprob", [-800.0, math.nan, math.inf, 1.0])
def test_unusable_probabilities_fall_back_to_fixed(logprob: float) -> None:
    tokens = response_tokens()
    tokens[2] = TokenLogprob(" 3", 0, {"3": logprob})
    scored = score_judgements(parse_judgement(result(tokens=tokens)))
    assert scored["JOB_FIT"]["scoreMethod"] == "FIXED"
    assert scored["LOGIC"]["scoreMethod"] == "PROBABILITY"


@pytest.mark.parametrize("text", ["", "not json", "{}", '{"JOB_FIT": {"reason": "근거"}}'])
def test_missing_probability_position_returns_none(text: str) -> None:
    assert level_probs([TokenLogprob(text, 0, {"3": 0})], Criterion.JOB_FIT) is None


def test_split_hangul_byte_tokens_keep_level_probability() -> None:
    """한 글자가 여러 토큰으로 나뉘어 바이트 표기로 전달돼도 단계 확률을 해석한다.

    실제 GMS(gpt-4.1-mini)는 「쿼」를 바이트 표기 토큰 세 개로 전달했다.
    """
    tokens = [
        TokenLogprob('{"JOB_FIT": {"reason": "느린', 0, {}),
        TokenLogprob(r" \xec", 0, {}),
        TokenLogprob(r"\xbf", 0, {}),
        TokenLogprob(r"\xbc", 0, {}),
        TokenLogprob('리 로그", "level":', 0, {}),
        TokenLogprob(" 3", 0, {"3": math.log(0.75), "2": math.log(0.25)}),
        TokenLogprob("}}", 0, {}),
    ]
    assert level_probs(tokens, Criterion.JOB_FIT) == pytest.approx({3: 0.75, 2: 0.25})


def test_escaped_backslash_in_reason_is_not_treated_as_byte_token() -> None:
    tokens = response_tokens(reason=r"경로 C:\x41")
    assert level_probs(tokens, Criterion.LOGIC) == pytest.approx({1: 0.1, 2: 0.3, 3: 0.6})


def test_combined_digit_and_punctuation_token_has_no_level_probability() -> None:
    tokens = [
        TokenLogprob('{"JOB_FIT": {"level":', 0, {}),
        TokenLogprob("3}", 0, {"3}": 0}),
        TokenLogprob("}", 0, {}),
    ]
    assert level_probs(tokens, Criterion.JOB_FIT) is None
