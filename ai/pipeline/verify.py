"""④ 인용 검증: 카드의 인용 문장이 원문에 실제로 있는지 확인하고, 없으면 버린다."""

import re
from typing import Any

# 원문(ㆍ U+318D)과 모델 출력에 섞여 나오는 가운뎃점 모양 글자들
_DOTS = re.compile("[ᆞᆆㆍ·‧・•]")


def normalize(text: str) -> str:
    """띄어쓰기와 가운뎃점 모양 차이는 뜻을 바꾸지 않으므로 비교에서 무시한다."""
    return re.sub(r"\s+", "", _DOTS.sub("ㆍ", text))


def verify_card(
    card: dict[str, Any], sources: dict[str, str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """sources는 항목 이름(talent, direction) → 그 항목의 원문.

    (인용이 확인된 항목만 남긴 카드, 버린 항목 목록)을 돌려준다.
    """
    kept = dict(card)
    dropped: list[dict[str, Any]] = []
    for field, source in sources.items():
        haystack = normalize(source)
        ok = []
        for item in card.get(field, []):
            quote = normalize(str(item.get("quote", "")))
            if quote and quote in haystack:
                ok.append(item)
            else:
                dropped.append({"field": field, **item})
        kept[field] = ok
    return kept, dropped
