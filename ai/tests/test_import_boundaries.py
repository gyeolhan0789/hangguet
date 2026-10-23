"""면접 에이전트와 분석 작업자의 코드가 서로를 import하지 않는지 확인한다.

두 실행 진입점은 다른 프로세스로 실행되고(docs/AI-미디어서버-분리계획.md),
함께 사용하는 형식은 app.common과 app.interview.speech에 둔다.
한쪽 코드를 변경할 때 다른 쪽이 함께 깨지지 않도록 경계를 시험으로 유지한다.
"""

import ast
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1] / "app"

AGENT = ("app.agent", "app.interview.realtime")
WORKER = (
    "app.worker",
    "app.interview.plan",
    "app.interview.scoring",
    "app.interview.result",
    "app.recording",
)
SHARED = ("app.common", "app.interview.speech")

# 각 쪽이 import하면 안 되는 쪽
FORBIDDEN = {"agent": WORKER, "worker": AGENT, "shared": AGENT + WORKER}


def _within(module: str, packages: tuple[str, ...]) -> bool:
    return any(module == package or module.startswith(package + ".") for package in packages)


def _side(module: str) -> str | None:
    for side, packages in (("agent", AGENT), ("worker", WORKER), ("shared", SHARED)):
        if _within(module, packages):
            return side
    return None


def _module_name(path: Path) -> str:
    parts = path.relative_to(APP.parent).with_suffix("").parts
    return ".".join(parts[:-1] if parts[-1] == "__init__" else parts)


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            # from app.interview import realtime처럼 하위 모듈을 이름으로 가져오는 경우도 검사한다
            names += [node.module] + [f"{node.module}.{alias.name}" for alias in node.names]
    return names


def _violations() -> list[str]:
    found = []
    for path in sorted(APP.rglob("*.py")):
        module = _module_name(path)
        side = _side(module)
        if side is None:
            continue
        for name in _imports(path):
            if _within(name, FORBIDDEN[side]):
                found.append(f"{module}({side}) → {name}")
    return found


def test_agent_worker_and_shared_code_keep_boundaries() -> None:
    assert _violations() == []


@pytest.mark.parametrize(
    ("module", "side"),
    [
        ("app.agent.main", "agent"),
        ("app.interview.realtime.transcript", "agent"),
        ("app.worker.queue", "worker"),
        ("app.interview.plan.job", "worker"),
        ("app.recording.merge", "worker"),
        ("app.common.results", "shared"),
        ("app.interview.speech", "shared"),
        ("app.main", None),
    ],
)
def test_modules_are_classified_by_package(module: str, side: str | None) -> None:
    """패키지 이름이 바뀌면 경계 검사가 해당 코드를 건너뛰므로 분류를 함께 확인한다."""
    assert _side(module) == side
