"""④-2 분류값: 검증을 통과한 카드 항목에 분류값을 부여한다(AI 명세 8장).

질문 생성은 이 값으로 회사 항목과 자소서 주장의 연결 후보를 코드로 선별한다.
인재상 항목에는 인재상 기준 12개 중 하나의 이름(`criterion`)을 부여한다.
"""

import logging
from typing import Any

from company_taxonomy.talent_criteria import TALENT_CRITERIA

from pipeline import card

log = logging.getLogger("pipeline")

CRITERION = "criterion"
CRITERION_NAMES = tuple(name for name, _ in TALENT_CRITERIA)

# 2026-11-10 연결 후보 실측(회사 연결 53/53 통과)에서 사용한 지시와 같게 기준 이름만 제시한다
CRITERION_SYSTEM = (
    "너는 회사 인재상 항목을 분류한다.\n"
    "- no: 항목 번호를 그대로 작성한다\n"
    "- criterion: 다음 인재상 기준 중 항목 내용과 가장 가까운 하나의 이름을 그대로 작성한다: "
    f"{', '.join(CRITERION_NAMES)}\n"
    'JSON으로만 답한다: {"items": [{"no": int, "criterion": str}]}'
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


def build_criterion_messages(name: str, talent: list[dict[str, Any]]) -> list[dict[str, str]]:
    lines = "\n".join(f"{no}. {_talent_text(item)}" for no, item in enumerate(talent, 1))
    user = f"회사: {name}\n\n[인재상 항목]\n{lines}"
    return [{"role": "system", "content": CRITERION_SYSTEM}, {"role": "user", "content": user}]


def _criteria(reply: dict[str, Any]) -> dict[int, str]:
    """응답에서 기준 이름이 목록에 있는 것만 항목 번호별로 반환한다."""
    picked: dict[int, str] = {}
    items = reply.get("items")
    if not isinstance(items, list):
        return picked
    for item in items:
        if not isinstance(item, dict):
            continue
        no, criterion = item.get("no"), item.get("criterion")
        # bool은 int의 하위 형식이므로 true가 1번 항목으로 해석되지 않도록 형식을 정확히 비교한다
        if type(no) is int and isinstance(criterion, str) and criterion in CRITERION_NAMES:
            picked[no] = criterion
    return picked


def add_criteria(name: str, talent: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`criterion`이 없는 인재상 항목에 인재상 기준을 부여한 목록을 반환한다.

    이미 `criterion`이 있는 항목은 모델에 전송하지 않고 유지한다.
    기존 카드 채우기(run.fill_classification)가 분류된 값을 변경하지 않게 하기 위함이다.
    모델이 기준 목록에 없는 이름을 작성하거나 호출이 실패하면
    그 항목은 `criterion` 없이 남기고 경고를 남긴다.
    분류값이 없는 항목은 질문 생성의 회사 연결 후보에서 제외될 뿐이므로(AI 명세 2장)
    카드는 저장하고, 빈 분류값은 기존 카드 채우기로 다시 채운다.
    """
    targets = [no for no, item in enumerate(talent) if CRITERION not in item]
    if not targets:
        return talent
    messages = build_criterion_messages(name, [talent[no] for no in targets])
    try:
        reply = card.call_llm(messages, model=card.talent_model())
    except (OSError, ValueError):  # LLM 오류·시간 초과·잘린 JSON
        log.warning("%s: 인재상 기준 분류 실패, 분류값 없이 저장한다", name, exc_info=True)
        return talent
    picked = _criteria(reply)
    result = list(talent)
    for order, no in enumerate(targets, 1):
        criterion = picked.get(order)
        if criterion is None:
            log.warning("%s: 인재상 기준을 정하지 못한 항목 %s", name, _talent_text(talent[no]))
            continue
        result[no] = {**talent[no], CRITERION: criterion}
    return result
