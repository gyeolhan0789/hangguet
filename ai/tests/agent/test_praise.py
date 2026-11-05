import logging
from pathlib import Path

import pytest

from app.agent.praise import load_praises
from app.interview.realtime.praise import Praise


def test_every_praise_has_recorded_voice() -> None:
    audios = load_praises()

    assert set(audios) == set(Praise)
    for audio in audios.values():
        # 24kHz·16비트 모노라 표본이 2바이트 단위이고, 칭찬 한 문장의 길이는 1~3초다
        assert len(audio.pcm) % 2 == 0
        assert 1_000 <= audio.duration_ms <= 3_000


def test_missing_voice_is_left_out(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    (tmp_path / "smile.pcm").write_bytes(b"\x00\x00" * 24_000)

    with caplog.at_level(logging.ERROR):
        audios = load_praises(tmp_path)

    assert set(audios) == {Praise.SMILE}
    assert "praise=no_judgment" in caplog.text
