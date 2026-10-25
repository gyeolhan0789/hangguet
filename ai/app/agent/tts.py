"""질문 글을 ElevenLabs로 합성해 음성(PCM)과 글자별 발음 시각을 받는다.

기준: AI 명세 6.2 질문(TTS)·6.3 interview.question(alignment.chars).
- ElevenLabs REST `with-timestamps`로 질문 글 하나를 한 번에 합성한다.
  면접방 메시지 started에 질문 전체의 글자별 시각을 담아야 하므로,
  시각이 조각마다 늦게 도착하는 스트리밍 대신 음성과 시각을 함께 받는 방식을 사용한다.
- 시각은 원문 기준 alignment를 사용한다.
  normalized_alignment는 숫자·기호를 읽는 글로 바꾼 글자라 화면의 질문 글과 글자가 맞지 않는다.
- 면접관별 음성 id·모델은 BE에서 5.12로 발급하던 값과 같다.
"""

from __future__ import annotations

import base64
import binascii
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, TypeGuard

import aiohttp

from app.common.session import Persona

log = logging.getLogger(__name__)
ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
MODEL_ID = "eleven_multilingual_v2"
# 무료 등급에서도 사용할 수 있는 PCM 형식이다(44.1kHz는 Pro 등급 이상)
OUTPUT_FORMAT = "pcm_24000"
SAMPLE_RATE = 24000
BYTES_PER_SAMPLE = 2
VOICE_IDS: Mapping[Persona, str] = {
    Persona.DEVIL: "DMyrgzQFny3JI1Y1paM5",
    Persona.COFFEE_CHAT: "21m00Tcm4TlvDq8ikWAM",
}
REQUEST_TIMEOUT = 15


class TtsError(RuntimeError):
    """질문 음성을 만들지 못했다. 메시지에는 질문 글·키를 포함하지 않는다."""


@dataclass(frozen=True)
class AlignedChar:
    """질문 음성 맨 앞을 0으로 한 글자 하나의 발음 시각(밀리초)."""

    char: str
    start_ms: int
    end_ms: int

    def to_json(self) -> dict[str, str | int]:
        return {"char": self.char, "startMs": self.start_ms, "endMs": self.end_ms}


@dataclass(frozen=True)
class SpeechAudio:
    """합성한 질문 음성. pcm은 24kHz·모노·s16le다."""

    pcm: bytes = field(repr=False)
    chars: tuple[AlignedChar, ...]

    @property
    def duration_ms(self) -> int:
        return len(self.pcm) // BYTES_PER_SAMPLE * 1000 // SAMPLE_RATE


def aligned_chars(alignment: Mapping[str, Any] | None) -> tuple[AlignedChar, ...]:
    """ElevenLabs alignment(초 단위)를 글자별 밀리초 시각으로 바꾼다. 없으면 빈 값이다."""
    if alignment is None:
        return ()
    chars = alignment.get("characters")
    starts = alignment.get("character_start_times_seconds")
    ends = alignment.get("character_end_times_seconds")
    if not (_is_list(chars) and _is_list(starts) and _is_list(ends)):
        raise TtsError("ElevenLabs alignment 형식이 올바르지 않다")
    if not len(chars) == len(starts) == len(ends):
        raise TtsError("ElevenLabs alignment의 글자 수와 시각 수가 다르다")
    result: list[AlignedChar] = []
    for char, start, end in zip(chars, starts, ends, strict=True):
        if not isinstance(char, str) or not _is_number(start) or not _is_number(end):
            raise TtsError("ElevenLabs alignment 값의 형식이 올바르지 않다")
        start_ms = max(0, round(start * 1000))
        # 화면이 끝 시각을 시작 시각보다 앞으로 받지 않도록 0 ≤ startMs ≤ endMs를 보장한다
        result.append(AlignedChar(char, start_ms, max(start_ms, round(end * 1000))))
    return tuple(result)


def _is_list(value: object) -> TypeGuard[Sequence[object]]:
    return isinstance(value, Sequence) and not isinstance(value, str)


def _is_number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, int | float) and not isinstance(value, bool)


class ElevenLabsTTS:
    def __init__(self, api_key: str | None, *, model: str = MODEL_ID) -> None:
        self._api_key = api_key
        self._model = model

    @property
    def configured(self) -> bool:
        return self._api_key is not None

    async def synthesize(self, text: str, persona: Persona) -> SpeechAudio:
        if self._api_key is None:
            raise TtsError("ELEVENLABS_API_KEY가 없다")
        try:
            async with (
                aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
                ) as session,
                session.post(
                    ELEVENLABS_URL.format(voice_id=VOICE_IDS[persona]),
                    params={"output_format": OUTPUT_FORMAT},
                    headers={"xi-api-key": self._api_key},
                    json={"text": text, "model_id": self._model},
                ) as response,
            ):
                if response.status != 200:
                    # 응답 본문에 요청 글이 포함될 수 있어 상태 코드만 남긴다
                    raise TtsError(f"ElevenLabs 합성 실패 (status={response.status})")
                body = await response.json()
        except (aiohttp.ClientError, TimeoutError, ValueError) as e:
            raise TtsError(f"ElevenLabs 호출 실패 ({type(e).__name__})") from e
        return speech_audio(body)


def speech_audio(body: object) -> SpeechAudio:
    if not isinstance(body, Mapping):
        raise TtsError("ElevenLabs 응답 형식이 올바르지 않다")
    encoded = body.get("audio_base64")
    if not isinstance(encoded, str):
        raise TtsError("ElevenLabs 응답에 audio_base64가 없다")
    try:
        pcm = base64.b64decode(encoded, validate=True)
    except binascii.Error as e:
        raise TtsError("ElevenLabs 음성 디코딩 실패") from e
    if not pcm or len(pcm) % BYTES_PER_SAMPLE:
        raise TtsError("ElevenLabs 음성 길이가 올바르지 않다")
    alignment = body.get("alignment")
    if alignment is not None and not isinstance(alignment, Mapping):
        raise TtsError("ElevenLabs alignment 형식이 올바르지 않다")
    return SpeechAudio(pcm, aligned_chars(alignment))
