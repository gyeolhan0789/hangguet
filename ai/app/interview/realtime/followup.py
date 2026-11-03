"""꼬리질문(AI 명세 2.2): 직전 기본 질문의 답변을 파고드는 질문을 GMS로 생성하는 규칙이다.

- 출제 순서는 FOLLOWUP_SEQS를 따른다.
  1번 답변 뒤 2번을, 3번 답변 뒤 4·5번을 한 번에 생성한다.
  4·5번을 함께 생성하는 것은 두 질문이 겹치지 않게 하고 5번 질문 앞에서 기다리지 않게 하기 위함이다.
- 면접관별 질문 수준과 인재상 기준은 질문 생성과 같은 지침(app.interview.interviewer)을 사용하고,
  악마 면접관의 압박 어조는 지시하지 않는다.
- 기다리는 시간이 짧으므로 출력이 틀려도 다시 생성하지 않고 실패로 처리한다.
  호출 측이 같은 순서의 예비 질문(미리 만든 질문)을 출제한다.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from app.common.session import Persona
from app.interview.interviewer import ANSWER, interviewer_guide

# AI 명세 2.2: 답변이 끝난 시점부터 생성을 기다리는 시간(초, 임시 값).
# 값을 정한 실측 근거는 AI 명세 2.2에 있다
FOLLOWUP_TIMEOUT = 4.0
# AI 명세 2.2·9장: 생성한 질문의 question.started에 담는 프롬프트 버전
FOLLOWUP_PROMPT_VERSION = "followup-v1"
# AI 명세 2.2 출제 순서: 기본 질문 seq → 그 답변으로 생성하는 꼬리질문 seq
FOLLOWUP_SEQS: Mapping[int, tuple[int, ...]] = {1: (2,), 3: (4, 5)}


class FollowupOutputError(ValueError):
    """GMS 출력이 꼬리질문 형식이 아니다(JSON 객체 아님, 개수 불일치, 빈 질문 글·채점 기준)."""


@dataclass(frozen=True)
class Followup:
    content: str
    criteria: str


def followup_system(persona: Persona, count: int) -> str:
    # 두 질문을 생성할 때만 서로 다른 측면을 지시한다.
    # 한 질문이면 비교할 대상이 없기 때문이다
    distinct = (
        "- 질문마다 답변의 서로 다른 측면을 묻고, 같은 내용을 겹쳐 묻지 않는다\n"
        if count > 1
        else ""
    )
    return (
        "너는 면접관으로서 직전 질문에 대한 지원자의 답변을 파고드는 꼬리질문을 생성한다. "
        "답변과 직전 질문에 없는 사실을 전제로 질문하지 않는다.\n"
        f"{interviewer_guide(persona, ANSWER)}"
        f"- questions: 정확히 {count}개\n"
        f"{distinct}"
        "- content: 지원자에게 묻는 질문 한 문장. 한 질문에서 한 가지만 묻는다\n"
        "- criteria: 이 질문의 답변을 채점할 기준 한 줄. 좋은 답변이 갖춰야 할 내용을 작성한다\n"
        'JSON으로만 답한다: {"questions": [{"content": str, "criteria": str}]}'
    )


def followup_messages(
    persona: Persona, question: str, criteria: str, answer: str, count: int
) -> list[dict[str, str]]:
    """직전 기본 질문의 글·채점 기준과 그 답변 글로 꼬리질문 count개를 요청하는 메시지다."""
    user = f"[직전 질문]\n{question}\n\n[직전 질문의 채점 기준]\n{criteria}\n\n[답변]\n{answer}"
    return [
        {"role": "system", "content": followup_system(persona, count)},
        {"role": "user", "content": user},
    ]


def _text(item: Mapping[str, Any], key: str) -> str:
    value = item.get(key)
    if not isinstance(value, str) or not value.strip():
        raise FollowupOutputError(f"questions.{key}가 비어 있다")
    return value.strip()


def parse_followups(content: Mapping[str, Any], count: int) -> tuple[Followup, ...]:
    """GMS 출력에서 꼬리질문 count개를 읽는다.

    형식이 틀리면 FollowupOutputError를 발생시킨다.
    """
    items = content.get("questions")
    if not isinstance(items, list) or len(items) != count:
        raise FollowupOutputError(f"questions가 {count}개가 아니다")
    followups = []
    for item in items:
        if not isinstance(item, dict):
            raise FollowupOutputError("questions 항목이 객체가 아니다")
        followups.append(Followup(_text(item, "content"), _text(item, "criteria")))
    return tuple(followups)
