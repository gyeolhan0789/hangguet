"""④-2 분류값: 검증을 통과한 카드 항목에 분류값을 부여한다(AI 명세 8장).

질문 생성은 이 값으로 회사 항목과 자소서 주장의 연결 후보를 코드로 선별한다.
- 인재상 항목: 인재상 기준 12개 중 하나의 이름(`criterion`)
- 사업 방향·시장·최근 이슈 항목: 그 상황을 담당할 직무의 NCS 세분류 이름 0~3개(`ncs_subcategories`)
"""

import logging
from collections.abc import Callable
from typing import Any

from company_taxonomy.ncs import NCS_SUBCATEGORIES
from company_taxonomy.talent_criteria import TALENT_CRITERIA

from pipeline import card

log = logging.getLogger("pipeline")

CRITERION = "criterion"
CRITERION_NAMES = tuple(name for name, _ in TALENT_CRITERIA)
SUBCATEGORIES = "ncs_subcategories"
MAX_SUBCATEGORIES = 3
NCS_SECTIONS = ("direction", "market", "recent")

# 2026-11-10 연결 후보 실측(회사 연결 53/53 통과)에서 사용한 지시와 같게 기준 이름만 제시한다
CRITERION_SYSTEM = (
    "너는 회사 인재상 항목을 분류한다.\n"
    "- no: 항목 번호를 그대로 작성한다\n"
    "- criterion: 다음 인재상 기준 중 항목 내용과 가장 가까운 하나의 이름을 그대로 작성한다: "
    f"{', '.join(CRITERION_NAMES)}\n"
    'JSON으로만 답한다: {"items": [{"no": int, "criterion": str}]}'
)

SUBCATEGORY_SYSTEM = (
    "너는 회사 정보 항목을 분류한다.\n"
    "- no: 항목 번호를 그대로 작성한다\n"
    "- ncs_subcategories: 항목의 상황을 담당할 직무를 다음 NCS 세분류 중 "
    f"0~{MAX_SUBCATEGORIES}개 골라 이름을 그대로 작성한다. "
    "해당하는 세분류가 없으면 빈 목록으로 작성한다: "
    f"{', '.join(NCS_SUBCATEGORIES)}\n"
    'JSON으로만 답한다: {"items": [{"no": int, "ncs_subcategories": [str]}]}'
)


def _talent_text(item: dict[str, Any]) -> str:
    # card-v8 이전 카드의 인재상은 keyword·quote 형식이다
    parts = [
        item.get("parent"),
        item.get("title") or item.get("keyword"),
        *(item.get("details") or []),
        item.get("quote"),
    ]
    return " / ".join(str(p) for p in parts if p)


def _item_text(item: dict[str, Any]) -> str:
    return " / ".join(str(p) for p in (item.get("summary"), item.get("quote")) if p)


def _criterion(value: Any) -> bool:
    return isinstance(value, str) and value in CRITERION_NAMES


def _subcategories(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) <= MAX_SUBCATEGORIES
        and len(set(map(str, value))) == len(value)
        and all(isinstance(name, str) and name in NCS_SUBCATEGORIES for name in value)
    )


def _picked(reply: dict[str, Any], key: str, valid: Callable[[Any], bool]) -> dict[int, Any]:
    """응답에서 분류값이 형식에 맞는 것만 항목 번호별로 반환한다."""
    picked: dict[int, Any] = {}
    items = reply.get("items")
    if not isinstance(items, list):
        return picked
    for item in items:
        if not isinstance(item, dict):
            continue
        no, value = item.get("no"), item.get(key)
        # bool은 int의 하위 형식이므로 true가 1번 항목으로 해석되지 않도록 형식을 정확히 비교한다
        if type(no) is int and valid(value):
            picked[no] = value
    return picked


def _classify(
    name: str,
    items: list[dict[str, Any]],
    *,
    key: str,
    system: str,
    title: str,
    text: Callable[[dict[str, Any]], str],
    valid: Callable[[Any], bool],
) -> list[dict[str, Any]]:
    """`key`가 없는 항목에만 분류값을 부여한 목록을 반환한다.

    이미 분류값이 있는 항목은 모델에 전송하지 않고 유지한다.
    기존 카드 채우기(run.fill_classification)가 분류된 값을 변경하지 않게 하기 위함이다.
    모델이 형식에 맞지 않는 값을 작성하거나 호출이 실패하면
    그 항목은 분류값 없이 남기고 경고를 남긴다.
    분류값이 없는 항목은 질문 생성의 회사 연결 후보에서 제외될 뿐이므로(AI 명세 2장)
    카드는 저장하고, 빈 분류값은 기존 카드 채우기로 다시 채운다.
    """
    targets = [no for no, item in enumerate(items) if key not in item]
    if not targets:
        return items
    lines = "\n".join(f"{order}. {text(items[no])}" for order, no in enumerate(targets, 1))
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"회사: {name}\n\n[{title}]\n{lines}"},
    ]
    try:
        reply = card.call_llm(messages, model=card.talent_model())
    except (OSError, ValueError):  # LLM 오류·시간 초과·잘린 JSON
        log.warning("%s: %s 분류 실패, 분류값 없이 저장한다", name, key, exc_info=True)
        return items
    picked = _picked(reply, key, valid)
    result = list(items)
    for order, no in enumerate(targets, 1):
        if order not in picked:
            log.warning("%s: %s를 정하지 못한 항목 %s", name, key, text(items[no]))
            continue
        result[no] = {**items[no], key: picked[order]}
    return result


def add_criteria(name: str, talent: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`criterion`이 없는 인재상 항목에 인재상 기준을 부여한 목록을 반환한다."""
    return _classify(
        name,
        talent,
        key=CRITERION,
        system=CRITERION_SYSTEM,
        title="인재상 항목",
        text=_talent_text,
        valid=_criterion,
    )


def add_subcategories(
    name: str, sections: dict[str, list[dict[str, Any]]]
) -> dict[str, list[dict[str, Any]]]:
    """여러 항목 묶음에서 `ncs_subcategories`가 없는 항목에 NCS 세분류를 부여해 반환한다.

    사업 방향과 시장처럼 함께 만드는 항목은 한 번의 호출로 분류한다.
    """
    items = [item for section in sections.values() for item in section]
    done = _classify(
        name,
        items,
        key=SUBCATEGORIES,
        system=SUBCATEGORY_SYSTEM,
        title="회사 항목",
        text=_item_text,
        valid=_subcategories,
    )
    result: dict[str, list[dict[str, Any]]] = {}
    start = 0
    for section, section_items in sections.items():
        result[section] = done[start : start + len(section_items)]
        start += len(section_items)
    return result
