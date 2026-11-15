"""그룹 면접 꼬리질문(AI 명세 6.7): 최종 답변을 보고 필요한지 판단하고, 필요하면 하나를 만든다.

- 개인 면접(2.2)과 달리 꼬리질문은 필수가 아니고 미리 만든 예비 질문도 없다.
  GMS 한 번으로 판단과 생성을 함께 한다. BE가 판단 단계 시작부터 7초 안에 온 판단만 쓰기 때문이다.
- 답변이 직전 질문의 채점 기준에서 확인할 핵심을 모두 구체적으로 보여 주면 필요 없고,
  빠졌거나 모호한 지점이 있으면 그 지점을 묻는 질문 하나를 만든다.
- 입력 · 생성 지침 · 검증은 2.2와 같다. 사용자 메시지는 개인 면접 꼬리질문과 같은 글이다.
- 출력이 틀리면 다시 만들지 않고 실패로 처리한다. 호출 측은 필요 없음으로 보낸다.
"""

from collections.abc import Mapping
from typing import Any

from app.common.session import Persona
from app.interview.interviewer import ANSWER, interviewer_guide
from app.interview.realtime.followup import (
    COMPANY_BLOCK,
    Followup,
    FollowupOutputError,
    followup_user,
)

# AI 명세 6.7 · 9장: 그룹 면접 꼬리질문 판단 프롬프트 버전.
# 개인 면접(followup-v2)과 지시가 달라 이름을 나눈다
GROUP_FOLLOWUP_PROMPT_VERSION = "group-followup-v1"
# GMS를 기다리는 시간(초, 임시 값). BE가 판단 단계 시작부터 7초 안에 온 판단만 쓰므로
# 최종 답변 도착 · 결과 전송 여유를 남긴다. 실측은 AI 성능 시험(AI 명세 6.7)에서 한다
GROUP_FOLLOWUP_TIMEOUT = 5.0


def group_followup_system(persona: Persona) -> str:
    return (
        "너는 면접관으로서 직전 질문에 대한 지원자의 답변을 보고 꼬리질문이 필요한지 판단한다. "
        "답변, 직전 질문, 그 질문의 연결 회사 정보에 없는 사실을 전제로 질문하지 않는다.\n"
        f"{interviewer_guide(persona, ANSWER)}"
        "- needed: 답변이 직전 질문의 채점 기준에서 확인할 핵심(근거 · 과정 · 결과 · 본인 역할)을 "
        "모두 구체적으로 보여 주면 false, 빠졌거나 모호한 지점이 있으면 true\n"
        "- question: needed가 true면 그 지점을 묻는 꼬리질문 하나, false면 null\n"
        "- content: 지원자에게 묻는 질문 한 문장. 한 질문에서 한 가지만 묻는다\n"
        "- criteria: 이 질문의 답변을 채점할 기준 한 줄. 좋은 답변이 갖춰야 할 내용을 작성한다\n"
        f"- {COMPANY_BLOCK}가 주어지면 답변이 그 회사 정보와 이어지는 지점을 파고들 수 있다\n"
        'JSON으로만 답한다: {"needed": bool, "question": {"content": str, "criteria": str} | null}'
    )


def group_followup_messages(
    persona: Persona,
    question: str,
    criteria: str,
    answer: str,
    company_item: Mapping[str, Any] | None = None,
) -> list[dict[str, str]]:
    """직전 질문의 글 · 채점 기준과 최종 답변으로 꼬리질문 판단을 요청하는 메시지다.

    company_item은 직전 질문이 개인 맞춤 질문일 때 그 질문의 연결 회사 항목이다.
    """
    return [
        {"role": "system", "content": group_followup_system(persona)},
        {"role": "user", "content": followup_user(question, criteria, answer, company_item)},
    ]


def parse_group_followup(content: Mapping[str, Any]) -> Followup | None:
    """GMS 출력을 읽는다. 꼬리질문이 필요 없으면 None이다.

    형식이 틀리면 FollowupOutputError를 발생시킨다.
    """
    needed = content.get("needed")
    if not isinstance(needed, bool):
        raise FollowupOutputError("needed가 참 · 거짓이 아니다")
    if not needed:
        return None
    question = content.get("question")
    if not isinstance(question, dict):
        raise FollowupOutputError("question이 객체가 아니다")
    return Followup(_text(question, "content"), _text(question, "criteria"))


def _text(item: Mapping[str, Any], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise FollowupOutputError(f"question.{key}가 비어 있다")
    return value.strip()
