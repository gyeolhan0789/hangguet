"""실제 Soniox 실시간 응답 고정 자료를 읽는다.

fixtures/soniox-responses.json은 실제 Soniox(stt-rt-v5, 끝 감지 사용) 응답 51개를 기록한 것이다.
답변 두 문장(앞 0.5초, 사이 1.5초, 뒤 3초 침묵)을 합성한 음성을 실시간 속도로 전송해 수신했다.
인증 값은 없다.
_recvMs는 WebSocket 연결을 시작한 시각을 0으로 한 응답 수신 시각(밀리초)이며,
기록 도구가 추가한 값이다.
"""

import json
from dataclasses import dataclass
from pathlib import Path

from app.interview.realtime.transcript import SonioxToken, soniox_tokens

FIXTURE = Path(__file__).parent / "fixtures" / "soniox-responses.json"

# 합성 음성의 원문 두 문장이다.
# 실제 응답의 확정 글이 이 원문과 글자 단위로 같다
FIRST_SENTENCE = "음, 저는 먼저 조회 쿼리의 실행 계획을 분석했습니다."
SECOND_SENTENCE = "그 결과 인덱스를 추가해서 응답 시간을 40% 줄였어요."


@dataclass(frozen=True)
class SonioxResponse:
    tokens: tuple[SonioxToken, ...]
    total_audio_proc_ms: int
    received_ms: int


def load_responses() -> list[SonioxResponse]:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return [
        SonioxResponse(
            tokens=soniox_tokens(response),
            total_audio_proc_ms=response["total_audio_proc_ms"],
            received_ms=response["_recvMs"],
        )
        for response in raw
    ]
