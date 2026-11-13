"""면접 에이전트의 꼬리질문 생성기 시험. GMS 호출은 대역으로 대체한다."""

import asyncio
import logging
from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from app.agent.assignment import AssignedQuestion
from app.agent.followup import FollowupError, GmsFollowups, followup_generator
from app.common.gms import GmsBadOutputError, GmsClient, GmsResult, GmsUnavailableError
from app.common.session import Persona
from app.common.settings import Settings, load_settings
from app.common.versions import REGISTRY, VersionKind
from app.interview.realtime.followup import FOLLOWUP_TIMEOUT

BASE = AssignedQuestion("응답 시간을 40% 줄인 과정은?", "원인 분석 · 수치 근거")


class FakeChat:
    def __init__(self, outcome: dict[str, Any] | Exception) -> None:
        self.outcome = outcome
        self.messages: list[Sequence[Mapping[str, str]]] = []

    def __call__(self, messages: Sequence[Mapping[str, str]]) -> GmsResult:
        self.messages.append(messages)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return GmsResult(self.outcome, "gpt-5.6-terra-2026-01-01")


def test_prompt_version_is_registered() -> None:
    assert REGISTRY.require(VersionKind.PROMPT, "followup-v2") == "followup-v2"


def test_generated_questions_carry_prompt_and_response_model_versions() -> None:
    chat = FakeChat(
        {
            "questions": [
                {"content": "어떤 지표로 원인을 찾았나요?", "criteria": "지표 근거"},
                {"content": "다른 방법은 검토했나요?", "criteria": "대안 비교"},
            ]
        }
    )

    questions = asyncio.run(GmsFollowups(chat).generate(Persona.DEVIL, BASE, "답변 글", 2))

    assert questions == (
        AssignedQuestion(
            "어떤 지표로 원인을 찾았나요?", "지표 근거", "followup-v2", "gpt-5.6-terra-2026-01-01"
        ),
        AssignedQuestion(
            "다른 방법은 검토했나요?", "대안 비교", "followup-v2", "gpt-5.6-terra-2026-01-01"
        ),
    )
    [messages] = chat.messages
    assert BASE.content in messages[1]["content"]
    assert BASE.criteria in messages[1]["content"]
    assert "답변 글" in messages[1]["content"]
    assert "[직전 질문과 연결한 회사 정보]" not in messages[1]["content"]


def test_previous_question_company_item_is_sent() -> None:
    """직전 기본 질문의 연결 회사 항목을 꼬리질문 생성 입력에 포함한다(AI 명세 2.2)."""
    item = {"section": "market", "summary": "간편결제 점유율 1위"}
    base = AssignedQuestion(BASE.content, BASE.criteria, company_item=item)
    chat = FakeChat({"questions": [{"content": "질문", "criteria": "기준"}]})

    asyncio.run(GmsFollowups(chat).generate(Persona.DUCK, base, "답변", 1))

    [messages] = chat.messages
    assert messages[1]["content"].endswith(
        "[직전 질문과 연결한 회사 정보]\n시장: 간편결제 점유율 1위"
    )


@pytest.mark.parametrize(
    "outcome",
    [
        GmsUnavailableError("GMS 오류 응답 503"),
        GmsBadOutputError("GMS 응답이 JSON 객체가 아니다"),
        {"questions": []},
    ],
)
def test_failures_become_followup_error(outcome: dict[str, Any] | Exception) -> None:
    generating = GmsFollowups(FakeChat(outcome)).generate(Persona.DUCK, BASE, "답변", 1)
    with pytest.raises(FollowupError):
        asyncio.run(generating)


def test_answer_text_is_not_logged(caplog: pytest.LogCaptureFixture) -> None:
    chat = FakeChat({"questions": [{"content": "질문", "criteria": "기준"}]})
    with caplog.at_level(logging.INFO, logger="app.agent.followup"):
        asyncio.run(GmsFollowups(chat).generate(Persona.DUCK, BASE, "비밀 답변", 1))

    assert all("비밀 답변" not in record.getMessage() for record in caplog.records)


@pytest.mark.parametrize(
    "env",
    [
        pytest.param({}, id="no-settings"),
        pytest.param({"LLM_CHAT_URL": "http://gms.test/chat", "LLM_API_KEY": "k"}, id="no-model"),
        pytest.param(
            {"LLM_CHAT_URL": "http://gms.test/chat", "LLM_MODEL": "gpt-5.6-terra"}, id="no-key"
        ),
        pytest.param(
            {
                "LLM_CHAT_URL": "http://gms.test/chat",
                "LLM_MODEL": "gpt-5.6-terra",
                "LLM_API_KEY": "",
            },
            id="empty-key",
        ),
        pytest.param(
            {"LLM_CHAT_URL": "http://gms.test/chat", "LLM_MODEL": "gpt-x", "LLM_API_KEY": "k"},
            id="unregistered-model",
        ),
    ],
)
def test_generation_is_turned_off_without_usable_gms_settings(env: dict[str, str]) -> None:
    """GMS 설정이 없으면 꼬리질문 생성만 끄고 면접은 예비 질문으로 진행한다."""
    assert followup_generator(load_settings(env)) is None


def test_generator_is_created_with_gms_settings() -> None:
    env = {"LLM_CHAT_URL": "http://gms.test/chat", "LLM_MODEL": "gpt-5.6-terra", "LLM_API_KEY": "k"}

    assert isinstance(followup_generator(load_settings(env)), GmsFollowups)


def test_generator_calls_gms_once_within_waiting_time(monkeypatch: pytest.MonkeyPatch) -> None:
    """기다리기를 그만둔 뒤 스레드가 GMS를 다시 호출하거나 오래 기다리지 않게 한다."""
    created: list[dict[str, Any]] = []
    original = GmsClient.from_settings

    def capture(settings: Settings, **kwargs: Any) -> GmsClient:
        created.append(kwargs)
        return original(settings, **kwargs)

    monkeypatch.setattr(GmsClient, "from_settings", capture)
    env = {"LLM_CHAT_URL": "http://gms.test/chat", "LLM_MODEL": "gpt-5.6-terra", "LLM_API_KEY": "k"}

    followup_generator(load_settings(env))

    assert created == [{"timeout": FOLLOWUP_TIMEOUT, "retry_delays": ()}]
