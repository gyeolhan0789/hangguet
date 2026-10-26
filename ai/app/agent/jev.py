"""Jev(POST /v1/systemone)로 면접관 리액션과 태도를 판단한다.

기준: AI 명세 6.4 리액션 판단, 9장 버전.
- STT·TTS와 같이 SDK 없이 aiohttp로 직접 호출한다.
  제한 시간·재시도를 이 모듈에서 결정하므로 SDK의 기본값(10초·재시도 2회)을 변경할 필요가 없다.
- 0.8초 안에 응답을 수신하지 못하거나 호출이 실패하면 리액션 없이 직전 태도를 반환한다.
  리액션이 늦거나 없어도 답변 진행은 계속되어야 하기 때문이다.
- 재시도하지 않는다.
  제한 시간이 짧아 재시도해도 시간 안에 응답을 수신하기 어렵고, 재시도 요청이 다음 판단과 경합한다.
- 연결은 면접 동안 재사용한다.
  Jev 서버는 미국에 있어 판단마다 새로 연결하면 연결 시간이 0.8초 제한의 상당 부분을 차지한다.
- 요청과 응답에는 답변 글이 포함되므로 본문을 로그에 남기지 않는다.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import aiohttp

from app.common.versions import REGISTRY, VersionKind
from app.interview.realtime.reaction import (
    REACTION_PROMPT_VERSION,
    InvalidJudgmentError,
    Judgment,
    ReactionContext,
    judgment_from,
    reaction_questions,
)

log = logging.getLogger(__name__)
JEV_URL = "https://api.typesafe.ai/v1/systemone"
# AI 명세 6.4: 별칭(jev-latest) 대신 버전 ID로 고정한다
JEV_MODEL = "jev-1.14.0"
# AI 명세 6.4(임시 값): 응답을 기다리는 상한(초)
JEV_TIMEOUT_SECONDS = 0.8


class JevError(RuntimeError):
    """Jev에서 판단을 수신하지 못했다."""


class JevJudge:
    def __init__(
        self,
        api_key: str,
        *,
        off_topic: bool = False,
        timeout_seconds: float = JEV_TIMEOUT_SECONDS,
    ) -> None:
        """off_topic이면 발화 중단을 위한 질문 이탈도 판단한다(화상 면접)."""
        self._api_key = api_key
        self._off_topic = off_topic
        self._model = REGISTRY.require(VersionKind.MODEL, JEV_MODEL)
        REGISTRY.require(VersionKind.PROMPT, REACTION_PROMPT_VERSION)
        self._timeout_seconds = timeout_seconds
        self._session: aiohttp.ClientSession | None = None

    async def judge(self, context: ReactionContext) -> Judgment:
        """판단하지 못하면 리액션 없이 직전 태도를 반환한다(AI 명세 6.4)."""
        try:
            async with asyncio.timeout(self._timeout_seconds):
                answers = await self._ask(
                    context.state(), reaction_questions(off_topic=self._off_topic)
                )
            return judgment_from(answers)
        except TimeoutError:
            log.warning("Jev 판단 시간 초과")
        except (JevError, InvalidJudgmentError) as e:
            log.warning("Jev 판단 실패: %s", e)
        return Judgment(None, context.attitude)

    async def aclose(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def _ask(self, state: dict[str, Any], questions: dict[str, Any]) -> object:
        if self._session is None:
            self._session = aiohttp.ClientSession()
        try:
            async with self._session.post(
                JEV_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"model": self._model, "state": state, "questions": questions},
            ) as response:
                if response.status != 200:
                    raise JevError(f"status={response.status}")
                body = await response.json()
        except (aiohttp.ClientError, ValueError) as e:
            raise JevError(type(e).__name__) from e
        if not isinstance(body, dict):
            raise JevError("응답이 객체가 아니다")
        return body.get("answers")
