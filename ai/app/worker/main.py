"""분석 작업자 실행부.

`python -m app.worker`로 면접 에이전트와 별도 프로세스로 실행한다.
미디어 서버·BE·FE와 한 서버(Lightsail 1대, 4코어, 운영 배포 계획 1장)의 CPU를 공유한다.
결과 생성처럼 GMS 응답을 수십 초 기다리는 작업이 면접 중 실시간 처리 시간에 영향을 주지 않도록
프로세스를 분리하고, 작업을 한 번에 하나씩 처리해 동시에 사용하는 CPU·메모리 양을 제한한다.
종료 신호를 수신하면 처리 중인 작업을 마친 뒤 종료한다.
작업이 끝나기 전에 강제 종료돼도 작업은 처리 중 리스트에 남아 다음 시작 때 다시 처리된다.
"""

import functools
import logging
import os
import signal
import threading
from collections.abc import Callable, Mapping
from types import FrameType
from typing import Protocol

from redis import RedisError

from app.common.gms import GmsClient
from app.common.redis import create_redis
from app.common.results import ResultPublisher
from app.common.settings import Settings, load_settings
from app.interview.cover_letter import CoverLetterChecker
from app.interview.plan.job import PlanJobHandler, gms_plan_chat, register_plan_handler
from app.interview.result.feedback import gms_feedback_chat
from app.interview.result.job import EvaluateJobHandler, register_evaluate_handler
from app.interview.scoring.job import (
    ScoreAnswerJobHandler,
    gms_score_chat,
    register_score_answer_handler,
)
from app.recording.job import RecordingMerger, register_merge_recording_handler
from app.recording.storage import create_s3_storage
from app.worker.checks import CoverLetterCheckWorker
from app.worker.dispatch import Dispatcher
from app.worker.queue import ReceiveResult, RedisJobQueue, WorkerQueue, worker_queue

log = logging.getLogger(__name__)

# Redis에 연결하지 못했을 때 다시 시도하기까지의 대기(초).
# Redis 재시작을 기다리는 동안 로그가 과도하게 남지 않을 정도로 둔다
RETRY_SECONDS = 5.0


class JobReceiver(Protocol):
    def recover(self) -> int: ...

    def receive_once(self) -> ReceiveResult: ...


def lazy_gms_client(settings: Settings) -> Callable[[], GmsClient]:
    """GMS 클라이언트를 처음 사용할 때 생성한다.

    시작 시점에 생성하면 LLM_* 값이 없을 때 작업자가 종료돼
    GMS를 사용하지 않는 작업까지 처리되지 않는다.
    처음 사용할 때 생성하면 GMS를 사용하는 작업만 실패한다.
    """

    @functools.cache
    def client() -> GmsClient:
        return GmsClient.from_settings(settings)

    return client


def build_dispatcher(settings: Settings, results: ResultPublisher) -> Dispatcher:
    """작업 종류별 처리 함수를 등록한 분배기를 생성한다.

    처리 함수는 그 작업 종류를 구현하는 변경에서 이 함수에 등록하고, 결과는 results로 전송한다.
    AI는 DB에 접속하지 않으므로 처리 함수에 넘기는 출력 수단은 결과 전송기다(AI 명세 1장).
    녹화 합치기만 합친 mp4를 녹화 저장소(S3)에 업로드하고 위치를 결과 메시지로 전달한다.
    등록 전에 도착한 작업은 처리 중 리스트에 남아 등록 뒤 재시작할 때 처리된다.
    """
    dispatcher = Dispatcher()
    client = lazy_gms_client(settings)
    register_plan_handler(dispatcher, PlanJobHandler(results, gms_plan_chat(client)))
    register_score_answer_handler(
        dispatcher, ScoreAnswerJobHandler(results, gms_score_chat(client))
    )
    register_evaluate_handler(
        dispatcher,
        EvaluateJobHandler(results, gms_score_chat(client), gms_feedback_chat(client)),
    )
    register_merge_recording_handler(
        dispatcher,
        RecordingMerger(functools.cache(lambda: create_s3_storage(settings)), results),
    )
    return dispatcher


class Worker:
    def __init__(
        self,
        queue: JobReceiver,
        stop: threading.Event,
        *,
        retry_seconds: float = RETRY_SECONDS,
    ) -> None:
        self._queue = queue
        self._stop = stop
        self._retry_seconds = retry_seconds

    def run(self) -> None:
        # 작업자가 Redis보다 먼저 시작돼도 종료되지 않도록 되돌리기도 연결될 때까지 다시 시도한다
        recovered = False
        while not self._stop.is_set():
            try:
                if not recovered:
                    self._queue.recover()
                    recovered = True
                self._queue.receive_once()
            except RedisError:
                log.exception("Redis 연결 실패, %.0f초 뒤 다시 시도한다", self._retry_seconds)
                self._stop.wait(self._retry_seconds)
            except Exception:
                # 수신한 작업은 이미 처리 중 리스트에 있으므로
                # 종료하면 재시작 때 같은 작업으로 다시 종료돼 뒤의 작업이 모두 멈춘다.
                # 기록만 하고 다음 작업을 계속 수신한다
                log.exception("작업 수신 중 예상하지 못한 오류, 다음 작업을 계속 수신한다")
                self._stop.wait(self._retry_seconds)
        log.info("종료 신호를 수신해 분석 작업자를 종료한다")


def install_signal_handlers(stop: threading.Event) -> None:
    """SIGTERM·SIGINT를 수신하면 진행 중인 작업을 중단하지 않고 다음 반복에서 종료하게 한다."""

    def request_stop(signum: int, frame: FrameType | None) -> None:
        stop.set()

    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, request_stop)


def main(env: Mapping[str, str] = os.environ) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = load_settings(env)
    # 모르는 큐 이름은 Redis에 연결하기 전에 실패시켜 잘못된 배포를 바로 드러낸다
    queue_kind = worker_queue(settings.worker_queue)
    stop = threading.Event()
    install_signal_handlers(stop)
    redis = create_redis(settings)
    try:
        # 작업 큐와 결과 큐는 같은 Redis에 있으므로 클라이언트 하나를 공유한다
        results = ResultPublisher(redis)
        # 큐와 관계없이 처리 함수를 모두 등록한다.
        # 큐를 나누기 전에 ai:jobs에 들어간 작업이
        # 처리 함수 없이 남지 않게 하기 위함이다(AI 명세 1.3)
        dispatcher = build_dispatcher(settings, results)
        queue = RedisJobQueue(redis, dispatcher, results, queue=queue_kind)
        # 자기소개서 검증은 BE가 기다리므로 작업 큐와 따로 받는다(AI 명세 2.1).
        # 큐를 나눠 작업자를 여럿 띄워도 한 곳에서만 받도록 기본 큐 작업자가 맡는다
        checks: threading.Thread | None = None
        if queue_kind is WorkerQueue.DEFAULT:
            checker = (
                CoverLetterChecker(settings.jev_api_key).check if settings.jev_api_key else None
            )
            checks = threading.Thread(
                target=CoverLetterCheckWorker(redis, checker, stop).run,
                name="cover-letter-check",
                daemon=True,
            )
            checks.start()
        log.info(
            "분석 작업자를 시작한다 queue=%s redis=%s:%s",
            queue_kind.key,
            settings.redis_host,
            settings.redis_port,
        )
        try:
            Worker(queue, stop).run()
        finally:
            # 작업자가 예외로 끝나도 검증 스레드가 닫힌 연결로 계속 돌지 않게 함께 멈춘다
            stop.set()
            if checks is not None:
                checks.join()
    finally:
        redis.close()
