"""등록된 Prompt·Model·Rubric 버전만 사용하게 한다(AI 명세 9장).

같은 입력으로 결과를 재현하려면 결과에 남긴 버전이 가리키는 내용이 하나여야 한다.
그래서 버전은 이 모듈에만 등록하고, 등록되지 않은 버전을 요청하면 처리를 시작하기 전에 실패한다.
작업을 추가할 때 그 작업이 사용하는 버전을 아래 목록에 한 줄씩 등록한다.
Model은 요청하는 모델 ID(LLM_MODEL)를 등록한다.
GMS는 날짜가 포함된 스냅샷 이름의 요청을 수락하지 않는다.
gpt-4.1-mini-2025-04-14로 요청하면 400을 반환하므로,
요청에는 모델 ID를 사용하고 결과에는 응답의 스냅샷 이름을 기록한다.
Model은 작업이 아닌 GMS 클라이언트마다 하나이므로,
클라이언트를 생성할 때 검사한다(app.common.gms).
Jev 모델도 같은 이유로 판단기를 생성할 때 검사한다(app.agent.jev).
"""

from dataclasses import dataclass
from enum import StrEnum


class VersionKind(StrEnum):
    PROMPT = "Prompt"
    MODEL = "Model"
    RUBRIC = "Rubric"


class UnregisteredVersionError(LookupError):
    """등록되지 않은 버전을 요청했다."""


@dataclass(frozen=True)
class Versions:
    prompt: str
    rubric: str


@dataclass(frozen=True)
class VersionRegistry:
    prompts: frozenset[str]
    models: frozenset[str]
    rubrics: frozenset[str]

    def require(self, kind: VersionKind, version: str) -> str:
        registered = {
            VersionKind.PROMPT: self.prompts,
            VersionKind.MODEL: self.models,
            VersionKind.RUBRIC: self.rubrics,
        }[kind]
        if version not in registered:
            raise UnregisteredVersionError(f"등록되지 않은 {kind} 버전: {version}")
        return version

    def resolve(self, *, prompt: str, rubric: str) -> Versions:
        """두 버전을 모두 확인한다.

        하나라도 등록되지 않았으면 실패한다.
        """
        return Versions(
            prompt=self.require(VersionKind.PROMPT, prompt),
            rubric=self.require(VersionKind.RUBRIC, rubric),
        )


REGISTRY = VersionRegistry(
    prompts=frozenset(
        {
            "plan-v5",
            "plan-v6",
            "plan-v7",
            "plan-v8",
            "plan-group-v1",
            "extract-claims-v1",
            "score-answer-v1",
            "score-answer-v2",
            "score-answer-v3",
            "evaluate-feedback-v1",
            "evaluate-feedback-v6",
            "evaluate-feedback-v7",
            "evaluate-feedback-v8",
            "evaluate-cover-letter-v1",
            "reaction-v1",
            "impression-v1",
            "timeline-feedback-v1",
            "cover-letter-check-v1",
            "cover-letter-check-v2",
            "followup-v1",
            "followup-v2",
            "group-followup-v1",
        }
    ),
    models=frozenset({"gpt-5.6-terra", "jev-1.14.0"}),
    rubrics=frozenset(),
)
