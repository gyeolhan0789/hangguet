"""면접 중 꼬리질문(AI 명세 2.2)을 GMS로 생성한다.

- GMS 클라이언트는 동기 HTTP(urllib)이므로 별도 스레드에서 호출한다.
  이벤트 루프에서 호출하면 그동안 면접방 메시지를 처리하지 못한다.
- 기다리는 시간이 짧으므로 재시도하지 않고, 요청 타임아웃도 그 시간(FOLLOWUP_TIMEOUT)으로 둔다.
  기다리기를 그만둔 뒤에도 스레드가 GMS 응답을 오래 기다리거나 다시 호출하지 않게 하기 위함이다.
- GMS 설정(LLM_CHAT_URL·LLM_MODEL)이 없거나 등록되지 않은 버전이면 꼬리질문 생성만 끈다.
  꼬리질문이 없어도 예비 질문으로 면접을 진행할 수 있기 때문이다(AI 명세 6.5).
- 요청에 지원자 답변이 담기므로 질문 글과 답변은 로그에 남기지 않는다.
"""

import asyncio
import logging
import time

from app.agent.assignment import AssignedQuestion
from app.common.gms import Chat, GmsBadOutputError, GmsClient, GmsUnavailableError
from app.common.session import Persona
from app.common.settings import Settings, SettingsError
from app.common.timing import elapsed_ms
from app.common.versions import REGISTRY, UnregisteredVersionError, VersionKind
from app.interview.realtime.followup import (
    FOLLOWUP_PROMPT_VERSION,
    FOLLOWUP_TIMEOUT,
    FollowupOutputError,
    followup_messages,
    parse_followups,
)
from app.interview.realtime.group_followup import (
    GROUP_FOLLOWUP_PROMPT_VERSION,
    GROUP_FOLLOWUP_TIMEOUT,
    group_followup_messages,
    parse_group_followup,
)

log = logging.getLogger(__name__)


class FollowupError(Exception):
    """GMS 호출이 실패했거나 출력이 꼬리질문 형식이 아니다."""


class GmsFollowups:
    def __init__(self, chat: Chat) -> None:
        """chat은 GMS 호출 함수이고, 시험은 유료 호출 대신 대역을 주입한다.

        프롬프트 버전이 등록되지 않았으면 UnregisteredVersionError를 발생시킨다(AI 명세 9장).
        """
        self._chat = chat
        self._prompt_version = REGISTRY.require(VersionKind.PROMPT, FOLLOWUP_PROMPT_VERSION)

    async def generate(
        self, persona: Persona, question: AssignedQuestion, answer: str, count: int
    ) -> tuple[AssignedQuestion, ...]:
        """직전 기본 질문과 그 답변으로 꼬리질문 count개를 생성한다.

        생성하지 못하면 FollowupError를 발생시킨다.
        """
        messages = followup_messages(
            persona, question.content, question.criteria, answer, count, question.company_item
        )
        started = time.monotonic()
        try:
            result = await asyncio.to_thread(self._chat, messages)
            followups = parse_followups(result.content, count)
        except (GmsUnavailableError, GmsBadOutputError, FollowupOutputError) as e:
            ms = elapsed_ms(started, time.monotonic())
            raise FollowupError(f"꼬리질문 생성 실패 ms={ms}: {e}") from e
        log.info("꼬리질문 생성 완료 ms=%d count=%d", elapsed_ms(started, time.monotonic()), count)
        return tuple(
            AssignedQuestion(item.content, item.criteria, self._prompt_version, result.model)
            for item in followups
        )


def followup_generator(settings: Settings) -> GmsFollowups | None:
    """GMS 설정으로 꼬리질문 생성기를 생성한다.

    설정이 없거나 등록되지 않은 버전이면 None이다.
    """
    # GMS는 키 없는 요청을 거절하므로 면접마다 실패할 호출을 하지 않도록 생성 자체를 끈다
    if settings.llm_api_key is None:
        log.warning("LLM_API_KEY가 없어 꼬리질문을 생성하지 않고 예비 질문으로 진행한다")
        return None
    try:
        client = GmsClient.from_settings(settings, timeout=FOLLOWUP_TIMEOUT, retry_delays=())
        return GmsFollowups(client.chat_json)
    except (SettingsError, UnregisteredVersionError) as e:
        log.warning("꼬리질문을 생성하지 않고 예비 질문으로 진행한다: %s", e)
        return None


class GmsGroupFollowups:
    """그룹 면접 꼬리질문 판단 · 생성(AI 명세 6.7)."""

    def __init__(self, chat: Chat) -> None:
        """프롬프트 버전이 등록되지 않았으면 UnregisteredVersionError를 발생시킨다(AI 명세 9장)."""
        self._chat = chat
        self._prompt_version = REGISTRY.require(VersionKind.PROMPT, GROUP_FOLLOWUP_PROMPT_VERSION)

    async def judge(
        self, persona: Persona, question: AssignedQuestion, answer: str
    ) -> AssignedQuestion | None:
        """직전 질문과 최종 답변으로 꼬리질문을 판단한다. 필요 없으면 None이다.

        판단하지 못하면 FollowupError를 발생시킨다.
        """
        messages = group_followup_messages(
            persona, question.content, question.criteria, answer, question.company_item
        )
        try:
            result = await asyncio.to_thread(self._chat, messages)
            followup = parse_group_followup(result.content)
        except (GmsUnavailableError, GmsBadOutputError, FollowupOutputError) as e:
            raise FollowupError(f"그룹 꼬리질문 판단 실패: {e}") from e
        if followup is None:
            return None
        return AssignedQuestion(
            followup.content, followup.criteria, self._prompt_version, result.model
        )


def group_followup_judge(settings: Settings) -> GmsGroupFollowups | None:
    """GMS 설정으로 그룹 꼬리질문 판단기를 만든다. 설정이 없거나 등록되지 않은 버전이면 None이다.

    없으면 판단 단계마다 필요 없음을 보낸다. 꼬리질문은 필수가 아니기 때문이다(AI 명세 6.7).
    """
    if settings.llm_api_key is None:
        log.warning("LLM_API_KEY가 없어 그룹 면접 꼬리질문을 만들지 않는다")
        return None
    try:
        client = GmsClient.from_settings(settings, timeout=GROUP_FOLLOWUP_TIMEOUT, retry_delays=())
        return GmsGroupFollowups(client.chat_json)
    except (SettingsError, UnregisteredVersionError) as e:
        log.warning("그룹 면접 꼬리질문을 만들지 않는다: %s", e)
        return None
