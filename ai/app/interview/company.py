"""회사 카드(AI 명세 8장)에서 면접관이 사용할 항목을 프롬프트용 글로 변환한다.

카드는 회사 정보 수집 파이프라인이 만든 JSON 그대로 전달되므로
(company-pipeline/pipeline/README.md 카드 형식),
형식이 맞지 않는 항목은 질문 생성을 실패시키지 않고 건너뛴다.
항목마다 (항목 번호, 프롬프트 줄)을 반환하고,
모델이 질문에 연결한 항목 번호가 주어진 항목인지 검사할 때 항목 번호를 사용한다.
"""

from collections.abc import Mapping
from typing import Any

from app.common.session import Persona

# 개발자 면접관은 경험을 회사 사업과,
# 악마 면접관은 자소서 주장을 회사 인재상과 연결해 묻는다(AI 명세 2장)
TALENT_TITLE = "회사 인재상"
BUSINESS_TITLE = "회사 사업 방향·시장"

CompanyItem = tuple[str, str]


def _texts(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [text.strip() for text in value if isinstance(text, str) and text.strip()]


def _entries(card: Mapping[str, Any], key: str) -> list[Mapping[str, Any]]:
    entries = card.get(key)
    if not isinstance(entries, list):
        return []
    return [entry for entry in entries if isinstance(entry, Mapping)]


def talent_items(card: Mapping[str, Any]) -> list[str]:
    """인재상 항목마다 「항목명(상위 범주): 설명」을 반환한다.

    card-v8 이전 카드는 항목명과 설명이 keyword·quote에 있으므로 함께 읽는다.
    """
    items = []
    for entry in _entries(card, "talent"):
        title = _texts(entry.get("title") or entry.get("keyword"))
        if not title:
            continue
        parent = _texts(entry.get("parent"))
        details = _texts(entry.get("details") or entry.get("quote"))
        name = f"{title[0]}({parent[0]})" if parent else title[0]
        items.append(f"{name}: {' / '.join(details)}" if details else name)
    return items


def business_items(card: Mapping[str, Any]) -> list[str]:
    """사업 방향·시장 항목마다 「사업 방향: 요약」을 반환한다."""
    items = []
    for key, label in (("direction", "사업 방향"), ("market", "시장")):
        for entry in _entries(card, key):
            summary = _texts(entry.get("summary"))
            if summary:
                items.append(f"{label}: {summary[0]}")
    return items


def company_items(card: Mapping[str, Any] | None, persona: Persona) -> list[CompanyItem]:
    """면접관이 사용할 회사 항목마다 (co1부터 매긴 번호, 「번호 항목」)을 반환한다.

    카드가 없으면 빈 목록이다.
    """
    if card is None:
        return []
    texts = talent_items(card) if persona is Persona.DEVIL else business_items(card)
    # 모델이 항목 이름에 프롬프트 줄의 상위 범주·머리말까지 덧붙여 작성해 이름이 어긋나므로
    # 주장 id처럼 번호로 가리키게 한다(plan-v4 GMS 실측)
    return [(f"co{no}", f"co{no} {text}") for no, text in enumerate(texts, start=1)]


def company_section(card: Mapping[str, Any] | None, persona: Persona) -> str:
    """면접관이 사용할 회사 정보 구역을 반환한다. 사용할 항목이 없으면 빈 글이다."""
    items = company_items(card, persona)
    if not items:
        return ""
    title = TALENT_TITLE if persona is Persona.DEVIL else BUSINESS_TITLE
    return f"[{title}]\n" + "\n".join(line for _, line in items)
