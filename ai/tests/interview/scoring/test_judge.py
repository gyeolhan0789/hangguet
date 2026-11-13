from collections.abc import Mapping
from typing import Any

import pytest

from app.common.answer import SttGap
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
    assert REGISTRY.require(VersionKind.PROMPT, PROMPT_VERSION) == "score-answer-v3"


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
    assert "41000" not in prompt
    assert "gazeRatio" not in prompt
    assert "DELIVERY 판정에만 사용" in prompt


@pytest.mark.parametrize("speech", [{}, {"pitchRangeSt": None}, {"speakingMs": 41000}])
def test_prompt_omits_unavailable_judging_metrics(speech: dict[str, object]) -> None:
    assert "말하기 지표" not in build_judge_messages("질문", "기준", "답변", speech)[1]["content"]


@pytest.mark.parametrize("level", [0, 4, True, 3.0, "3", None])
def test_invalid_level_is_structure_failure(level: Any) -> None:
    response = result({**GOOD, "LOGIC": {"level": level, "reason": "근거"}})
    with pytest.raises(StructureBrokenError):
        parse_judgement(response)


@pytest.mark.parametrize("reason", [None, "", " \n", 3])
def test_invalid_reason_is_structure_failure(reason: Any) -> None:
    response = result({**GOOD, "LOGIC": {"level": 3, "reason": reason}})
    with pytest.raises(StructureBrokenError):
        parse_judgement(response)


@pytest.mark.parametrize("criterion", list(Criterion))
def test_missing_criterion_is_structure_failure(criterion: Criterion) -> None:
    response = result({key: value for key, value in GOOD.items() if key != criterion})
    with pytest.raises(StructureBrokenError):
        parse_judgement(response)


def test_non_object_criterion_is_structure_failure() -> None:
    response = result({**GOOD, "LOGIC": 3})
    with pytest.raises(StructureBrokenError):
        parse_judgement(response)


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


def test_prompt_marks_stt_gaps_and_does_not_penalize_them() -> None:
    """AI 명세 3장 판정 입력: 끊긴 위치를 추가하고,
    그 앞뒤의 말 중단·반복은 감점 근거로 삼지 않는다.
    """
    system, user = (
        m["content"]
        for m in build_judge_messages("질문", "기준", "답변", None, (SttGap(1200, 4000),))
    )
    assert "[음성 인식이 끊긴 구간(답변 시작 기준)]\n- 1.2~4.0초" in user
    assert "그 앞뒤의 말 중단·반복을 감점 근거로 삼지 않는다" in user
    assert "음성 인식" not in system


def test_prompt_without_stt_gaps_has_no_gap_section() -> None:
    """끊김이 없으면 끊김을 언급하지 않는다."""
    messages = build_judge_messages("질문", "기준", "답변", None)
    assert all("음성 인식" not in m["content"] for m in messages)
    assert all("앞뒤의 말 중단·반복" not in m["content"] for m in messages)


# 기준: AI 명세 3장 판정 지침(JOB_FIT·LOGIC 단계 설명, 가정 상황 질문 해석)
@pytest.mark.parametrize(
    "line",
    [
        "- JOB_FIT 3: 질문이 확인하는 역량에 대해 본인이 수행한 구체적 행동과 사용한 방법, "
        "그 방법을 선택한 이유를 제시해 경험과 직무 요구를 연결한다",
        "  JOB_FIT 2: 관련 경험과 본인 행동은 제시하지만 "
        "방법을 선택한 이유나 직무 요구와의 연결이 누락되어 있다",
        "  JOB_FIT 1: 결과·수치나 일반론만 제시하고 본인이 수행한 행동이나 방법이 없다",
        "- LOGIC 3: 원인(상황) → 조치 → 결과(확인 방법) 순서가 분명하다",
        "  LOGIC 2: 셋 중 하나가 누락되었거나 서로 연결되지 않는다",
        "  LOGIC 1: 셋 중 둘 이상이 누락되었거나 결과만 나열한다",
        "- 가정 상황 질문은 원인을 문제 정의로, 조치를 적용할 방법과 그 이유로, "
        "결과를 적용 결과를 확인할 방법으로 해석한다",
    ],
)
def test_system_has_level_descriptions(line: str) -> None:
    system = build_judge_messages("질문", "기준", "답변", None)[0]["content"]

    assert f"{line}\n" in system.split("단계 기준:\n", 1)[1]
