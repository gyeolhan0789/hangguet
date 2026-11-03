import pytest

from app.common.versions import (
    REGISTRY,
    UnregisteredVersionError,
    VersionKind,
    VersionRegistry,
    Versions,
)

REGISTERED = VersionRegistry(
    prompts=frozenset({"score-answer-v1"}),
    models=frozenset({"gpt-5.6-terra"}),
    rubrics=frozenset({"rubric-v1"}),
)


def test_returns_registered_versions() -> None:
    versions = REGISTERED.resolve(prompt="score-answer-v1", rubric="rubric-v1")

    assert versions == Versions(prompt="score-answer-v1", rubric="rubric-v1")


@pytest.mark.parametrize(
    ("kind", "version"),
    [
        (VersionKind.PROMPT, "score-answer-v2"),
        (VersionKind.MODEL, "gpt-4.1-mini"),
        (VersionKind.RUBRIC, "rubric-v0"),
    ],
)
def test_unregistered_version_raises(kind: VersionKind, version: str) -> None:
    with pytest.raises(UnregisteredVersionError, match=version):
        REGISTERED.require(kind, version)


@pytest.mark.parametrize(
    ("prompt", "rubric", "kind"),
    [
        ("score-answer-v2", "rubric-v1", "Prompt"),
        ("score-answer-v1", "rubric-v0", "Rubric"),
    ],
)
def test_resolve_fails_when_any_version_is_unregistered(
    prompt: str, rubric: str, kind: str
) -> None:
    """버전 하나만 등록되지 않아도 처리를 시작하지 않는다."""
    with pytest.raises(UnregisteredVersionError, match=kind):
        REGISTERED.resolve(prompt=prompt, rubric=rubric)


def test_registered_kind_does_not_leak_to_other_kind() -> None:
    """Prompt 버전으로 등록된 값을 Rubric 버전으로 사용할 수 없다."""
    with pytest.raises(UnregisteredVersionError):
        REGISTERED.require(VersionKind.RUBRIC, "score-answer-v1")


def test_default_registry_accepts_requested_model_id() -> None:
    """요청하는 모델 ID를 허용한다."""
    assert REGISTRY.require(VersionKind.MODEL, "gpt-5.6-terra") == "gpt-5.6-terra"


@pytest.mark.parametrize("model", ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-5"])
def test_default_registry_rejects_unregistered_model(model: str) -> None:
    """응답의 스냅샷 이름과 등록하지 않은 모델 ID는 허용하지 않는다."""
    with pytest.raises(UnregisteredVersionError):
        REGISTRY.require(VersionKind.MODEL, model)


def test_default_registry_rejects_unknown_version() -> None:
    with pytest.raises(UnregisteredVersionError):
        REGISTRY.require(VersionKind.PROMPT, "unknown-v1")
