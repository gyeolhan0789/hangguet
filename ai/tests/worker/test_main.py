import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import cast

import pytest
from redis import ConnectionError as RedisConnectionError
from redis import Redis

from app.common.gms import GmsClient, HttpResponse
from app.common.redis import create_redis
from app.common.results import ResultPublisher
from app.common.settings import load_settings
from app.interview.scoring.judge import TOP_LOGPROBS
from app.worker import main as main_module
from app.worker.dispatch import DispatchResult
from app.worker.main import Worker, build_dispatcher, install_signal_handlers
from app.worker.messages import MergeRecordingJob, PlanJob
from app.worker.queue import ReceiveResult
from tests.interview.scoring.test_job import JOB as SCORE_JOB
from tests.interview.scoring.test_job import good

# BE가 작업을 요청한 시각(AI 명세 1.3 requestedAt)
REQUESTED_AT = datetime(2026, 10, 22, 14, 3, 13, tzinfo=timezone(timedelta(hours=9)))
AI_ROOT = Path(__file__).resolve().parents[2]
# 대역 호출 횟수 상한.
# 각 테스트가 기대하는 호출 수보다 충분히 크게 둔다
MAX_CALLS = 20


class ScriptedQueue:
    """정해진 순서로 결과를 반환하거나 예외를 발생시키고, 호출 순서를 기록하는 큐 대역."""

    def __init__(
        self,
        stop: threading.Event,
        *,
        recover: list[int | Exception] | None = None,
        receive: list[ReceiveResult | Exception] | None = None,
    ) -> None:
        self.stop = stop
        self.calls: list[str] = []
        self._recover = list(recover or [0])
        self._receive = list(receive or [])

    def record(self, name: str) -> None:
        # 종료 처리가 망가지면 반복이 끝나지 않으므로, 상한을 넘으면 반복을 멈추고 즉시 실패시킨다
        self.calls.append(name)
        if len(self.calls) > MAX_CALLS:
            self.stop.set()
            pytest.fail("종료 신호가 반영되지 않아 반복이 끝나지 않았다")

    def recover(self) -> int:
        self.record("recover")
        outcome = self._recover.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def receive_once(self) -> ReceiveResult:
        self.record("receive")
        if not self._receive:
            self.stop.set()
            return ReceiveResult.EMPTY
        outcome = self._receive.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class RecordingEvent(threading.Event):
    """대기 시간을 기록하고 즉시 반환하는 종료 플래그 대역.

    테스트가 실제로 대기하지 않게 한다.
    """

    def __init__(self) -> None:
        super().__init__()
        self.waits: list[float | None] = []

    def wait(self, timeout: float | None = None) -> bool:
        self.waits.append(timeout)
        return self.is_set()


def test_recovers_once_then_receives_until_stopped() -> None:
    stop = threading.Event()
    queue = ScriptedQueue(stop, receive=[ReceiveResult.HANDLED, ReceiveResult.FAILED])

    Worker(queue, stop, retry_seconds=0).run()

    assert queue.calls == ["recover", "receive", "receive", "receive"]


def test_does_not_start_when_already_stopped() -> None:
    stop = threading.Event()
    stop.set()
    queue = ScriptedQueue(stop)

    Worker(queue, stop, retry_seconds=0).run()

    assert queue.calls == []


def test_redis_error_is_retried_instead_of_exiting() -> None:
    """Redis 시작이 늦거나 연결이 잠시 중단돼도 종료되지 않고 되돌리기부터 다시 시도한다."""
    stop = RecordingEvent()
    queue = ScriptedQueue(
        stop,
        recover=[RedisConnectionError("refused"), 1],
        receive=[RedisConnectionError("reset"), ReceiveResult.HANDLED],
    )

    Worker(queue, stop, retry_seconds=5).run()

    assert queue.calls == ["recover", "recover", "receive", "receive", "receive"]
    # Redis가 중단된 동안 연결 거부가 즉시 반복돼 CPU와 로그를 소비하지 않도록 오류마다 대기한다
    assert stop.waits == [5, 5]


def test_unexpected_error_is_logged_and_receiving_continues() -> None:
    """예상하지 못한 오류로 종료하면 재시작 때 같은 작업으로 다시 종료되므로 계속 수신한다."""
    stop = RecordingEvent()
    queue = ScriptedQueue(stop, receive=[RuntimeError("decode"), ReceiveResult.HANDLED])

    Worker(queue, stop, retry_seconds=5).run()

    assert queue.calls == ["recover", "receive", "receive", "receive"]
    assert stop.waits == [5]


def test_normal_receive_does_not_wait() -> None:
    """작업 대기는 BLMOVE가 담당하므로 정상 수신 사이에는 추가로 대기하지 않는다."""
    stop = RecordingEvent()
    queue = ScriptedQueue(stop, receive=[ReceiveResult.HANDLED, ReceiveResult.EMPTY])

    Worker(queue, stop, retry_seconds=5).run()

    assert stop.waits == []


def test_stop_during_job_finishes_current_job_first() -> None:
    """종료 신호는 처리 중인 작업을 중단하지 않고 다음 반복에서 반영된다."""
    stop = threading.Event()
    finished: list[str] = []

    class StopWhileHandling(ScriptedQueue):
        def receive_once(self) -> ReceiveResult:
            self.record("receive")
            stop.set()
            finished.append("job")
            return ReceiveResult.HANDLED

    queue = StopWhileHandling(stop)

    Worker(queue, stop, retry_seconds=0).run()

    assert queue.calls == ["recover", "receive"]
    assert finished == ["job"]


def test_sigterm_during_job_stops_after_job_finishes() -> None:
    """실제 SIGTERM을 처리 도중 수신해도 그 작업을 마친 뒤 반복을 종료한다."""
    stop = threading.Event()
    finished: list[str] = []

    class SignalWhileHandling(ScriptedQueue):
        def receive_once(self) -> ReceiveResult:
            self.record("receive")
            signal.raise_signal(signal.SIGTERM)
            finished.append("job")
            return ReceiveResult.HANDLED

    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        install_signal_handlers(stop)
        queue = SignalWhileHandling(stop)
        Worker(queue, stop, retry_seconds=0).run()
    finally:
        for sig, old in previous.items():
            signal.signal(sig, old)

    assert queue.calls == ["recover", "receive"]
    assert finished == ["job"]


PLAN = PlanJob(
    job_id="8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34",
    session_id=55,
    requested_at=REQUESTED_AT,
    company_name="회사",
    job_title="직무",
    cover_letter="자소서",
)


class RecordingRedis:
    def __init__(self) -> None:
        self.pushed: list[str] = []

    def lpush(self, key: str, *values: str) -> int:
        self.pushed.extend(values)
        return len(self.pushed)


def test_dispatcher_handles_plan_after_checking_gms_settings() -> None:
    """PLAN 처리 함수가 등록돼 있다.

    LLM_* 값이 없으면 첫 GMS 호출에서 실패 결과를 전송한다.
    """
    redis = RecordingRedis()
    dispatcher = build_dispatcher(load_settings({}), ResultPublisher(cast(Redis, redis)))

    assert dispatcher.dispatch(PLAN) is DispatchResult.HANDLED
    assert [json.loads(raw)["type"] for raw in redis.pushed] == ["plan.failed"]


def test_dispatcher_has_no_handler_until_job_types_are_implemented() -> None:
    """처리 함수가 없는 작업은 미처리로 남아 유실되지 않는다."""
    job = MergeRecordingJob(
        job_id="8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34",
        session_id=55,
        requested_at=REQUESTED_AT,
        raw_prefix="recordings/raw/55/",
        object_key="recordings/55.mp4",
    )
    settings = load_settings({})
    # 클라이언트 생성은 Redis에 접속하지 않으므로 Redis 없이 분배기를 생성할 수 있다
    results = ResultPublisher(create_redis(settings))

    assert build_dispatcher(settings, results).dispatch(job) is DispatchResult.NO_HANDLER


def test_dispatcher_handles_scoring_without_gms_settings() -> None:
    redis = RecordingRedis()
    dispatcher = build_dispatcher(load_settings({}), ResultPublisher(cast(Redis, redis)))
    assert dispatcher.dispatch(SCORE_JOB) is DispatchResult.HANDLED
    assert redis.pushed == []


def test_dispatcher_connects_scoring_to_shared_gms_client(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads: list[dict[str, object]] = []

    def transport(payload: dict[str, object]) -> HttpResponse:
        payloads.append(payload)
        body = {
            "model": "served-model",
            "choices": [{"message": {"content": json.dumps(good().content)}}],
        }
        return HttpResponse(200, {}, json.dumps(body).encode())

    client = GmsClient(model="gpt-4.1-mini", transport=transport)
    monkeypatch.setattr(main_module, "lazy_gms_client", lambda settings: lambda: client)
    redis = RecordingRedis()
    dispatcher = build_dispatcher(load_settings({}), ResultPublisher(cast(Redis, redis)))
    assert dispatcher.dispatch(SCORE_JOB) is DispatchResult.HANDLED
    [message] = [json.loads(raw) for raw in redis.pushed]
    assert message["type"] == "answer.scored"
    assert message["evaluation"]["modelVersion"] == "served-model"
    assert payloads[0]["logprobs"] is True
    assert payloads[0]["top_logprobs"] == TOP_LOGPROBS


class ClosableRedis:
    def __init__(self) -> None:
        self.closed = 0

    def close(self) -> None:
        self.closed += 1


def test_main_closes_redis_even_when_worker_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """작업자가 예외로 종료돼도 Redis 연결을 닫아 Redis에 종료된 연결이 남지 않게 한다."""
    redis = ClosableRedis()

    class FailingWorker:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def run(self) -> None:
            raise RuntimeError("stopped")

    monkeypatch.setattr(main_module, "create_redis", lambda settings: redis)
    monkeypatch.setattr(main_module, "install_signal_handlers", lambda stop: None)
    monkeypatch.setattr(main_module, "Worker", FailingWorker)

    with pytest.raises(RuntimeError, match="stopped"):
        main_module.main({})

    assert redis.closed == 1


def start_worker(redis_port: int) -> subprocess.Popen[bytes]:
    env = {**os.environ, "REDIS_HOST": "127.0.0.1", "REDIS_PORT": str(redis_port)}
    for name in ("LLM_CHAT_URL", "LLM_MODEL", "LLM_API_KEY"):
        env.pop(name, None)
    return subprocess.Popen(
        [sys.executable, "-m", "app.worker"],
        cwd=AI_ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def test_module_entry_keeps_running_without_redis_and_gms_settings() -> None:
    """Redis가 아직 없고 GMS 접속 값이 없어도 프로세스가 종료되지 않는다."""
    process = start_worker(redis_port=1)
    try:
        time.sleep(1.5)
        assert process.poll() is None
    finally:
        process.kill()
        process.wait(timeout=10)


@pytest.mark.skipif(
    sys.platform == "win32", reason="Windows에는 SIGTERM을 다른 프로세스에 전송할 수 없다"
)
def test_module_entry_exits_cleanly_on_sigterm() -> None:
    process = start_worker(redis_port=1)
    time.sleep(1.0)

    process.send_signal(signal.SIGTERM)

    assert process.wait(timeout=15) == 0
