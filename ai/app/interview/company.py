"""회사 카드(AI 명세 8장)에서 면접관이 질문에 연결할 수 있는 후보 항목을 선별한다.

카드는 회사 정보 수집 파이프라인이 만든 JSON 그대로 전달되므로
(company-pipeline/pipeline/README.md 카드 형식),
형식이 맞지 않는 항목은 질문 생성을 실패시키지 않고 건너뛴다.
연결 후보는 카드 항목의 분류값으로 코드가 선별한다(AI 명세 2장 회사 카드 사용).
- 인재상 항목은 분류값(criterion)이 주장의 인재상 기준에 있을 때, 그 주장과만 연결할 수 있다.
- 사업 방향·시장·최근 이슈 항목은 분류값(ncs_subcategories)에 지원 직무의 NCS 세분류가 있을 때
  후보다.
- 분류값이 없는 항목은 후보가 아니다. 분류값을 추가하기 전에 만든 카드나
  분류에 실패한 항목에는 분류값이 없다(AI 명세 8장).
후보마다 co1부터 번호를 매기고, 모델이 질문에 연결한 번호를 검사할 때 이 번호를 사용한다.
"""

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.common.session import Persona
from app.worker.messages import Claim

TALENT_TITLE = "회사 인재상"
BUSINESS_TITLE = "회사 사업 방향·시장"
RECENT_TITLE = "회사 최근 이슈"


@dataclass(frozen=True)
class CompanyItem:
    """질문에 연결할 수 있는 회사 항목 하나다."""

    id: str
    # 프롬프트에서 이 항목이 속한 구역 이름
    title: str
    text: str
    # 이 항목과 연결할 수 있는 주장 id. None이면 질문 생성에 전달한 주장 모두와 연결할 수 있다
    claim_ids: tuple[str, ...] | None
    # 항목이 있는 카드 칸 이름(talent·direction·market·recent)과 카드 항목 그대로의 값
    section: str
    entry: Mapping[str, Any]

    @property
    def line(self) -> str:
        # 연결할 수 있는 주장은 항목 줄에 함께 작성한다. 후보마다 연결 지시 줄을 따로 추가하면
        # 후보가 많은 오리 면접관이 질문 3~4개를 연결해 연결 수 상한을 자주 초과했다(GMS 실측)
        if self.claim_ids is None:
            return f"{self.id} {self.text}"
        return f"{self.id} {self.text} (연결 가능한 주장: {', '.join(self.claim_ids)})"

    def json(self) -> dict[str, Any]:
        """플랜의 질문별 연결 회사 항목 형식이다(AI 명세 2장 companyItem).

        BE가 최신 회사 카드의 항목과 칸을 비교해 보관함 질문을 폐기하므로
        카드 항목의 칸을 이름과 값 그대로 담는다.
        """
        return {"section": self.section, **self.entry}


# 번호를 매기기 전의 후보: (프롬프트 글, 연결할 수 있는 주장 id, 카드 칸 이름, 카드 항목)
Candidate = tuple[str, tuple[str, ...] | None, str, Mapping[str, Any]]


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


def _talent_text(entry: Mapping[str, Any]) -> str | None:
    """인재상 항목을 「항목명(상위 범주): 설명」으로 반환한다.

    card-v8 이전 카드는 항목명과 설명이 keyword·quote에 있으므로 함께 읽는다.
    """
    title = _texts(entry.get("title") or entry.get("keyword"))
    if not title:
        return None
    parent = _texts(entry.get("parent"))
    details = _texts(entry.get("details") or entry.get("quote"))
    name = f"{title[0]}({parent[0]})" if parent else title[0]
    return f"{name}: {' / '.join(details)}" if details else name


def _talent_candidates(card: Mapping[str, Any], claims: Sequence[Claim]) -> list[Candidate]:
    """인재상 항목 중 분류값이 주장의 인재상 기준에 있는 항목과 그 주장 id를 반환한다."""
    candidates: list[Candidate] = []
    for entry in _entries(card, "talent"):
        text = _talent_text(entry)
        # 분류값이 없거나 기준 이름이 아니면 같은 기준의 주장이 없으므로 후보에서 제외된다
        criterion = entry.get("criterion")
        claim_ids = tuple(c.id for c in claims if criterion in c.talent_criteria)
        if text is not None and claim_ids:
            candidates.append((text, claim_ids, "talent", entry))
    return candidates


def _matching_summary(entry: Mapping[str, Any], subcategories: Collection[str]) -> str | None:
    """분류값에 지원 직무 세분류가 있으면 항목의 요약을, 없으면 None을 반환한다."""
    summary = _texts(entry.get("summary"))
    classified = entry.get("ncs_subcategories")
    if not summary or not isinstance(classified, list):
        return None
    if not any(name in subcategories for name in classified):
        return None
    return summary[0]


def _with_quote(text: str, entry: Mapping[str, Any]) -> str:
    """항목 글 뒤에 원문을 덧붙인다. 원문이 없으면 항목 글만 반환한다.

    사업 방향·시장·최근 이슈에 연결한 질문은 회사 항목의 원문을 인용해 상황을 제시하므로
    원문을 함께 전달한다(AI 명세 2장 회사 카드 사용).
    """
    quote = _texts(entry.get("quote"))
    return f"{text} (원문: {quote[0]})" if quote else text


def _business_candidates(
    card: Mapping[str, Any], subcategories: Collection[str]
) -> list[Candidate]:
    """사업 방향·시장 항목 중 분류값에 지원 직무 세분류가 있는 항목을 반환한다.

    항목은 「구분: 요약 (원문: …)」 형식이다.
    """
    candidates: list[Candidate] = []
    for key, label in (("direction", "사업 방향"), ("market", "시장")):
        for entry in _entries(card, key):
            summary = _matching_summary(entry, subcategories)
            if summary is not None:
                candidates.append((_with_quote(f"{label}: {summary}", entry), None, key, entry))
    return candidates


def _recent_candidates(card: Mapping[str, Any], subcategories: Collection[str]) -> list[Candidate]:
    """최근 이슈 항목 중 분류값에 지원 직무 세분류가 있는 항목을 반환한다.

    항목은 「기사 날짜: 요약 (원문: …)」 형식이다.

    질문이 언제의 이슈인지 드러나도록 기사 날짜를 함께 전달한다. 날짜가 없으면 요약만 전달한다.
    """
    candidates: list[Candidate] = []
    for entry in _entries(card, "recent"):
        summary = _matching_summary(entry, subcategories)
        if summary is None:
            continue
        published = _texts(entry.get("published"))
        text = f"{published[0]}: {summary}" if published else summary
        candidates.append((_with_quote(text, entry), None, "recent", entry))
    return candidates


# 악마 면접관은 인재상·최근 이슈, 개발자 면접관은 사업 방향·시장·최근 이슈,
# 오리 면접관은 전부 사용한다(AI 명세 2장)
_SECTIONS: Mapping[Persona, Sequence[str]] = {
    Persona.DEVIL: (TALENT_TITLE, RECENT_TITLE),
    Persona.COFFEE_CHAT: (BUSINESS_TITLE, RECENT_TITLE),
    Persona.DUCK: (TALENT_TITLE, BUSINESS_TITLE, RECENT_TITLE),
}


def _candidates(
    title: str,
    card: Mapping[str, Any],
    claims: Sequence[Claim],
    subcategories: Collection[str],
) -> list[Candidate]:
    if title == TALENT_TITLE:
        return _talent_candidates(card, claims)
    if title == RECENT_TITLE:
        return _recent_candidates(card, subcategories)
    return _business_candidates(card, subcategories)


def company_items(
    card: Mapping[str, Any] | None,
    persona: Persona,
    claims: Sequence[Claim],
    subcategories: Collection[str],
) -> list[CompanyItem]:
    """면접관이 질문에 연결할 수 있는 회사 항목을 co1부터 번호를 매겨 반환한다.

    claims는 질문 생성에 전달하는 주장이고, subcategories는 지원 직무의 NCS 세분류다.
    카드가 없거나 후보가 없으면 빈 목록이다.
    """
    if card is None:
        return []
    items: list[CompanyItem] = []
    for title in _SECTIONS.get(persona, ()):
        # 모델이 항목 이름에 프롬프트 줄의 상위 범주·머리말까지 덧붙여 작성해 이름이 어긋나므로
        # 주장 id처럼 번호로 가리키게 한다(plan-v4 GMS 실측).
        # 구역이 여러 개여도 번호가 겹치지 않도록 이어서 매긴다
        for text, claim_ids, section, entry in _candidates(title, card, claims, subcategories):
            items.append(CompanyItem(f"co{len(items) + 1}", title, text, claim_ids, section, entry))
    return items


def company_section(items: Sequence[CompanyItem]) -> str:
    """회사 항목을 구역별로 나눈 프롬프트 글을 반환한다. 항목이 없으면 빈 글이다."""
    titles = dict.fromkeys(item.title for item in items)
    return "\n\n".join(
        f"[{title}]\n" + "\n".join(item.line for item in items if item.title == title)
        for title in titles
    )
