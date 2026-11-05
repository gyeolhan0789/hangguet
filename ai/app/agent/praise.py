"""오리 면접관 칭찬 음성 파일(AI 명세 6.2 호응)을 읽는다.

음성은 tts.py와 같은 음성 id·모델·형식(pcm_24000)으로 미리 합성해 duck_praise에 둔다.
파일 이름은 Praise 값이다.
"""

import logging
from pathlib import Path

from app.agent.tts import SpeechAudio
from app.interview.realtime.praise import Praise

log = logging.getLogger(__name__)
PRAISE_DIR = Path(__file__).with_name("duck_praise")


def load_praises(directory: Path = PRAISE_DIR) -> dict[Praise, SpeechAudio]:
    """칭찬마다 음성을 반환한다.

    읽지 못한 칭찬은 결과에서 제외하며,
    그 칭찬을 선택한 답변 뒤에는 칭찬 없이 다음 질문으로 진행한다.
    """
    audios: dict[Praise, SpeechAudio] = {}
    for praise in Praise:
        try:
            pcm = (directory / f"{praise.value}.pcm").read_bytes()
        except OSError as e:
            log.error("칭찬 음성을 읽지 못했다 praise=%s: %s", praise.value, type(e).__name__)
            continue
        audios[praise] = SpeechAudio(pcm, ())
    return audios
