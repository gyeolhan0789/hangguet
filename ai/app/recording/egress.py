"""LiveKit 녹화 목록 조회(ListEgress)로 트랙 파일의 녹화 시작 시각을 얻는다(AI 명세 7장).

- 웹훅은 전송을 보장하지 않으므로 끝난 녹화도 반환하는 목록 조회를 사용한다.
- 면접방의 트랙 녹화가 모두 끝날 때까지 다시 조회한다.
  녹화가 끝나야 파일이 저장소에 업로드되고 파일 결과가 목록에 기록되기 때문이다.
- 정상 완료되고 시작 시각이 있으며 길이가 0보다 큰 파일만 반환한다.
  Egress는 첫 패킷을 수신하지 못한 파일의 시작 시각을 종료 시각으로 채우므로
  시작 시각만으로는 빈 트랙을 구분할 수 없다.
- 시작 시각을 얻지 못하면 None을 반환하고, 호출한 쪽이 저장소 목록으로 트랙을 이어 붙인다.
  조회가 연속으로 실패하면 최대 대기 시간을 기다리지 않고 중단한다.
  LiveKit 장애 중에 작업마다 최대 대기 시간을 채우면
  뒤에 대기한 작업이 BE 최대 대기 시간을 넘기 때문이다.
"""

import asyncio
import logging
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta

import aiohttp
from google.protobuf.message import DecodeError
from livekit import api

from app.common.settings import Settings

log = logging.getLogger(__name__)

# 다시 조회하는 간격과 최대 대기 시간(초, 임시 값).
# 개발 서버에서 방 삭제부터 녹화 업로드 완료까지의 시간을 측정한 뒤 조정한다
POLL_SECONDS = 5.0
WAIT_SECONDS = 300.0
MAX_FAILURES = 3
_ENDED = frozenset(
    {
        api.EgressStatus.EGRESS_COMPLETE,
        api.EgressStatus.EGRESS_FAILED,
        api.EgressStatus.EGRESS_ABORTED,
        api.EgressStatus.EGRESS_LIMIT_REACHED,
    }
)
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

type ListEgress = Callable[[str], Sequence[api.EgressInfo]]
type TrackStarts = list[tuple[str, datetime]]


class EgressLookupError(Exception):
    """LiveKit 녹화 목록을 조회하지 못했다."""


def room_name(session_id: int) -> str:
    """면접방 이름(AI 명세 6장 방 이름)."""
    return f"interview-{session_id}"


def finished_files(items: Sequence[api.EgressInfo]) -> TrackStarts | None:
    """녹화가 모두 끝났으면 사용할 파일의 (저장소 키, 녹화 시작 시각) 목록이다.

    진행 중인 녹화가 있으면 None이다.
    """
    if any(item.status not in _ENDED for item in items):
        return None
    return [
        # filename은 Egress가 업로드한 저장소 키다(egress v1.15.0 config/output_file.go)
        (file.filename, _EPOCH + timedelta(microseconds=file.started_at // 1000))
        for item in items
        if item.status == api.EgressStatus.EGRESS_COMPLETE
        for file in item.file_results
        if file.duration > 0 and file.started_at > 0
    ]


def livekit_list_egress(url: str, api_key: str, api_secret: str) -> ListEgress:
    """면접방의 녹화 목록(끝난 녹화 포함)을 조회하는 함수를 반환한다.

    실패하면 EgressLookupError다.
    """

    async def list_room(room: str) -> Sequence[api.EgressInfo]:
        async with api.LiveKitAPI(url, api_key, api_secret) as livekit:
            response = await livekit.egress.list_egress(api.ListEgressRequest(room_name=room))
        return list(response.items)

    def list_egress(room: str) -> Sequence[api.EgressInfo]:
        try:
            # 분석 작업자는 동기 코드이므로 조회마다 이벤트 루프를 생성한다
            return asyncio.run(list_room(room))
        except (api.TwirpError, aiohttp.ClientError, TimeoutError, DecodeError) as e:
            raise EgressLookupError(f"녹화 목록 조회 실패: {type(e).__name__}") from e

    return list_egress


class TrackStartLookup:
    def __init__(
        self,
        list_egress: ListEgress,
        *,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._list = list_egress
        self._sleep = sleep
        self._clock = clock

    def __call__(self, session_id: int) -> TrackStarts | None:
        """그 면접의 트랙 녹화가 모두 끝날 때까지 조회해 파일별 녹화 시작 시각을 반환한다.

        최대 대기 시간이 지나거나 조회가 연속으로 실패하면 None이다.
        """
        room = room_name(session_id)
        deadline = self._clock() + WAIT_SECONDS
        failures = 0
        while True:
            try:
                files = finished_files(self._list(room))
            except EgressLookupError as e:
                failures += 1
                if failures >= MAX_FAILURES:
                    log.warning("녹화 목록 조회를 중단한다 sessionId=%s: %s", session_id, e)
                    return None
            else:
                failures = 0
                if files is not None:
                    return files
            if self._clock() >= deadline:
                log.warning("녹화가 끝나지 않아 조회를 중단한다 sessionId=%s", session_id)
                return None
            self._sleep(POLL_SECONDS)


def no_track_starts(_session_id: int) -> None:
    """녹화 시작 시각을 조회하지 않는다. 녹화는 이어 붙여 합친다."""
    return None


def create_track_start_lookup(settings: Settings) -> Callable[[int], TrackStarts | None]:
    """설정의 LiveKit 주소·키로 녹화 시작 시각 조회 함수를 생성한다.

    값이 없으면 조회하지 않고 None을 반환하는 함수다.
    LiveKit 설정 없이도 녹화를 이어 붙여 합칠 수 있게 하기 위함이다.
    """
    url, key, secret = settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret
    if url is None or key is None or secret is None:
        log.warning("LiveKit 설정이 없어 녹화 시작 시각 없이 녹화를 합친다")
        return no_track_starts
    return TrackStartLookup(livekit_list_egress(url, key, secret))
