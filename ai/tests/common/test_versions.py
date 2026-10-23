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
    models=frozenset({"gpt-4.1-mini"}),
    rubrics=frozenset({"rubric-v1"}),
)


def test_returns_registered_versions() -> None:
    versions = REGISTERED.resolve(prompt="score-answer-v1", rubric="rubric-v1")

    assert versions == Versions(prompt="score-answer-v1", rubric="rubric-v1")


@pytest.mark.parametrize(
    ("kind", "version"),
    [
        (VersionKind.PROMPT, "score-answer-v2"),
        (VersionKind.MODEL, "gpt-4.1-mini-2025-04-14"),
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
    """GMS에 요청하는 모델 ID를 등록한다. 응답의 스냅샷 이름은 등록 대상이 아니다."""
    assert REGISTRY.require(VersionKind.MODEL, "gpt-4.1-mini") == "gpt-4.1-mini"
    with pytest.raises(UnregisteredVersionError):
        REGISTRY.require(VersionKind.MODEL, "gpt-4.1-mini-2025-04-14")


def test_default_registry_rejects_unknown_version() -> None:
    with pytest.raises(UnregisteredVersionError):
        REGISTRY.require(VersionKind.PROMPT, "unknown-v1")
