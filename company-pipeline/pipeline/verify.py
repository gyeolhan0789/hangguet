"""④ 인용 검증: 인용이 원문에 실제로 있고, 요약이 인용에 없는 숫자를 만들지 않았는지 본다."""

import re
from typing import Any

# 원문(ㆍ U+318D)과 모델 출력에 섞여 나오는 가운뎃점 모양 글자들
_DOTS = re.compile("[ᆞᆆㆍ·‧・•]")


def normalize(text: str) -> str:
    """띄어쓰기와 가운뎃점 모양 차이는 뜻을 바꾸지 않으므로 비교에서 무시한다."""
    return re.sub(r"\s+", "", _DOTS.sub("ㆍ", text))


def _numbers(text: str) -> set[float]:
    """6.0과 6, 1,100과 1100은 같은 숫자로 본다."""
    return {float(n.replace(",", "")) for n in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}


def _summary_ok(item: dict[str, Any]) -> bool:
    """요약의 숫자는 인용에도 있어야 한다. 모델이 인용 밖 점유율·연차를 지어내는 경우를 막는다."""
    summary = str(item.get("summary") or item.get("keyword") or "")
    return _numbers(summary) <= _numbers(str(item.get("quote", "")))


def verify_card(
    card: dict[str, Any], sources: dict[str, str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """sources는 항목 이름(talent, direction) → 그 항목의 원문.

    인용이 원문에 있고 요약 숫자가 인용과 맞는 항목만 남긴 카드와 버린 항목 목록을 돌려준다.
    """
    kept = dict(card)
    dropped: list[dict[str, Any]] = []
    for field, source in sources.items():
        haystack = normalize(source)
        ok = []
        for item in card.get(field, []):
            quote = normalize(str(item.get("quote", "")))
            if quote and quote in haystack and _summary_ok(item):
                ok.append(item)
            else:
                dropped.append({"field": field, **item})
        kept[field] = ok
    return kept, dropped
