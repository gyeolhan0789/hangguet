from collections.abc import Mapping
from typing import Any

import pytest

from app.common.gms import GmsResult
from app.common.versions import REGISTRY, VersionKind
from app.interview.scoring.judge import (
    PROMPT_VERSION,
    Criterion,
    StructureBrokenError,
    build_judge_messages,
    parse_judgement,
    score_judgements,
)
from app.interview.speech import LONG_PAUSE_MS

GOOD = {criterion.value: {"reason": "판정 근거", "level": 3} for criterion in Criterion}


def result(content: Mapping[str, Any] | None = None) -> GmsResult:
    return GmsResult(dict(GOOD if content is None else content), "test-model")


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


@pytest.mark.parametrize(("level", "score"), [(1, 50), (2, 70), (3, 90)])
def test_every_criterion_uses_fixed_level_score(level: int, score: int) -> None:
    """gpt-5.6-terra 등 시험한 GMS 모델 중 gpt-4.1-mini를 제외한 모델이 logprobs를 지원하지 않으므로
    모든 항목을 판정 단계의 고정 점수로 계산한다.
    """
    content = {criterion.value: {"reason": "판정 근거", "level": level} for criterion in Criterion}
    scored = score_judgements(parse_judgement(result(content)))
    assert scored == {
        criterion.value: {
            "level": level,
            "score": score,
            "scoreMethod": "FIXED",
            "reason": "판정 근거",
        }
        for criterion in Criterion
    }
