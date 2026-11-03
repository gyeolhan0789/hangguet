from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import aiohttp
import pytest
from google.protobuf.message import DecodeError
from livekit import api

from app.common.settings import load_settings
from app.recording.egress import (
    MAX_FAILURES,
    POLL_SECONDS,
    WAIT_SECONDS,
    EgressLookupError,
    TrackStartLookup,
    create_track_start_lookup,
    finished_files,
    livekit_list_egress,
    no_track_starts,
)

Status = api.EgressStatus
KEY = "recordings/raw/55/candidate-video-TR_V1.mp4"
# 2026-11-03T10:00:00.123456789Z(나노초)
STARTED_NS = 1_793_700_000_123_456_789
STARTED = datetime(2026, 11, 3, 10, 0, 0, 123456, tzinfo=UTC)


def info(status: int, *files: tuple[str, int, int]) -> api.EgressInfo:
    """(저장소 키, 시작 시각 나노초, 길이 나노초) 파일 결과를 담은 녹화 정보."""
    return api.EgressInfo(
        status=status,  # type: ignore[arg-type]
        file_results=[
            api.FileInfo(filename=key, started_at=started, duration=duration)
            for key, started, duration in files
        ],
    )


def test_finished_files_keeps_start_time_to_microseconds() -> None:
    items = [info(Status.EGRESS_COMPLETE, (KEY, STARTED_NS, 5_000_000_000))]
    assert finished_files(items) == [(KEY, STARTED)]


@pytest.mark.parametrize(
    "status", [Status.EGRESS_STARTING, Status.EGRESS_ACTIVE, Status.EGRESS_ENDING]
)
def test_finished_files_waits_while_any_recording_is_running(status: int) -> None:
    items = [
        info(Status.EGRESS_COMPLETE, (KEY, STARTED_NS, 5_000_000_000)),
        info(status),
    ]
    assert finished_files(items) is None


@pytest.mark.parametrize(
    "status", [Status.EGRESS_FAILED, Status.EGRESS_ABORTED, Status.EGRESS_LIMIT_REACHED]
)
def test_finished_files_excludes_recordings_not_completed(status: int) -> None:
    items = [
        info(Status.EGRESS_COMPLETE, (KEY, STARTED_NS, 5_000_000_000)),
        info(status, ("recordings/raw/55/candidate-audio-TR_A1.ogg", STARTED_NS, 5_000_000_000)),
    ]
    assert finished_files(items) == [(KEY, STARTED)]


def test_finished_files_excludes_empty_file() -> None:
    """Egress는 첫 패킷이 없는 파일의 시작 시각을 종료 시각으로 채우므로 길이로 구분한다."""
    items = [info(Status.EGRESS_COMPLETE, (KEY, STARTED_NS, 0))]
    assert finished_files(items) == []


def test_finished_files_excludes_file_without_start_time() -> None:
    items = [info(Status.EGRESS_COMPLETE, (KEY, 0, 5_000_000_000))]
    assert finished_files(items) == []


class FakeEgress:
    """조회마다 다음 응답을 반환하고, 마지막 응답은 계속 반환한다. 예외는 발생시킨다."""

    def __init__(self, *responses: Sequence[api.EgressInfo] | Exception) -> None:
        self.responses = list(responses)
        self.rooms: list[str] = []

    def __call__(self, room: str) -> Sequence[api.EgressInfo]:
        response = self.responses[min(len(self.rooms), len(self.responses) - 1)]
        self.rooms.append(room)
        if isinstance(response, Exception):
            raise response
        return response


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0

    def sleep(self, seconds: float) -> None:
        assert seconds == POLL_SECONDS
        self.now += seconds


def lookup(fake: FakeEgress, time: FakeTime) -> TrackStartLookup:
    return TrackStartLookup(fake, sleep=time.sleep, clock=lambda: time.now)


DONE = [info(Status.EGRESS_COMPLETE, (KEY, STARTED_NS, 5_000_000_000))]
RUNNING = [info(Status.EGRESS_ACTIVE)]


def test_lookup_polls_room_until_recordings_end() -> None:
    fake, time = FakeEgress(RUNNING, RUNNING, DONE), FakeTime()

    assert lookup(fake, time)(55) == [(KEY, STARTED)]
    assert fake.rooms == ["interview-55"] * 3
    assert time.now == 2 * POLL_SECONDS


def test_lookup_gives_up_when_recordings_do_not_end_in_time() -> None:
    fake, time = FakeEgress(RUNNING), FakeTime()

    assert lookup(fake, time)(55) is None
    assert time.now == WAIT_SECONDS
    assert len(fake.rooms) == int(WAIT_SECONDS / POLL_SECONDS) + 1


def test_lookup_stops_after_consecutive_failures() -> None:
    """LiveKit 장애 중에 작업마다 최대 대기 시간을 채우지 않는다."""
    fake, time = FakeEgress(EgressLookupError("녹화 목록 조회 실패")), FakeTime()

    assert lookup(fake, time)(55) is None
    assert len(fake.rooms) == MAX_FAILURES


def test_lookup_retries_failure_followed_by_success() -> None:
    error = EgressLookupError("녹화 목록 조회 실패")
    responses = [error] * (MAX_FAILURES - 1) + [RUNNING] + [error] * (MAX_FAILURES - 1) + [DONE]
    fake, time = FakeEgress(*responses), FakeTime()

    assert lookup(fake, time)(55) == [(KEY, STARTED)]
    assert len(fake.rooms) == len(responses)


def test_without_livekit_settings_track_starts_are_not_looked_up() -> None:
    settings = load_settings({"LIVEKIT_URL": "ws://livekit:7880", "LIVEKIT_API_KEY": "key"})
    assert create_track_start_lookup(settings) is no_track_starts


def test_with_livekit_settings_track_starts_are_looked_up() -> None:
    settings = load_settings(
        {
            "LIVEKIT_URL": "ws://livekit:7880",
            "LIVEKIT_API_KEY": "key",
            "LIVEKIT_API_SECRET": "secret",
        }
    )
    assert isinstance(create_track_start_lookup(settings), TrackStartLookup)


class FakeLiveKitAPI:
    """api.LiveKitAPI 대신 녹화 목록 요청과 접속 값을 기록한다."""

    created: list[tuple[str, str, str]] = []
    requests: list[api.ListEgressRequest] = []
    error: Exception | None = None

    def __init__(self, url: str, api_key: str, api_secret: str) -> None:
        self.created.append((url, api_key, api_secret))
        self.egress = self

    async def __aenter__(self) -> "FakeLiveKitAPI":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def list_egress(self, request: api.ListEgressRequest) -> api.ListEgressResponse:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return api.ListEgressResponse(items=DONE)


@pytest.fixture
def fake_api(monkeypatch: pytest.MonkeyPatch) -> type[FakeLiveKitAPI]:
    FakeLiveKitAPI.created, FakeLiveKitAPI.requests, FakeLiveKitAPI.error = [], [], None
    monkeypatch.setattr(api, "LiveKitAPI", FakeLiveKitAPI)
    return FakeLiveKitAPI


def test_livekit_list_egress_lists_room_with_settings(fake_api: type[FakeLiveKitAPI]) -> None:
    items = livekit_list_egress("ws://livekit:7880", "key", "secret")("interview-55")

    assert list(items) == DONE
    assert fake_api.created == [("ws://livekit:7880", "key", "secret")]
    assert [request.room_name for request in fake_api.requests] == ["interview-55"]


@pytest.mark.parametrize(
    "error",
    [
        api.TwirpError("unavailable", "LiveKit 장애", status=503),
        aiohttp.ClientConnectionError("연결 실패"),
        TimeoutError(),
        DecodeError("protobuf가 아닌 응답"),
    ],
)
def test_livekit_list_egress_failure_is_lookup_error(
    fake_api: type[FakeLiveKitAPI], error: Exception
) -> None:
    fake_api.error = error
    with pytest.raises(EgressLookupError):
        livekit_list_egress("ws://livekit:7880", "key", "secret")("interview-55")
