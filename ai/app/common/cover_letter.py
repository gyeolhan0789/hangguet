"""자기소개서 문항(API 명세 4.1 coverLetterItems)을 읽고 프롬프트용 글로 만든다.

BE는 자기소개서를 문항 순서대로 질문·답변 배열로 보낸다(AI 명세 2장·2.1·4장).
검증 큐(app.worker.checks)와 작업 메시지(app.worker.messages)가 같은 규칙으로 읽는다.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.common.answer import is_java_blank

# API 명세 4.1: 지원서 하나의 문항 수
MAX_ITEMS = 5
# 이전 BE 메시지의 coverLetter(글 하나)를 옮길 문항 질문. BE V13 마이그레이션과 같은 값이다
LEGACY_QUESTION = "자기소개서"


@dataclass(frozen=True)
class CoverLetterItem:
    """자기소개서 문항 하나. 순서는 목록 순서다."""

    question: str
    answer: str


class InvalidCoverLetterError(ValueError):
    """coverLetterItems 형식이 틀렸다."""


def _text(item: dict[object, object], key: str, index: int) -> str:
    value = item.get(key)
    # 공백 기준은 BE @NotBlank와 같게 둔다
    if not isinstance(value, str) or is_java_blank(value):
        raise InvalidCoverLetterError(
            f"coverLetterItems[{index}].{key}는 비어 있지 않은 문자열이어야 한다"
        )
    return value


def parse_cover_letter_items(value: object, legacy: object = None) -> tuple[CoverLetterItem, ...]:
    """coverLetterItems를 읽는다. 형식이 틀리면 InvalidCoverLetterError다.

    coverLetterItems가 없고 이전 BE 메시지의 coverLetter(legacy)가 있으면 1번 문항으로 읽는다.
    배포하는 동안 큐에 남은 이전 메시지를 버리지 않기 위한 호환이며,
    다음 배포에서 지운다(CONTRIBUTING 3.1).
    """
    if value is None and isinstance(legacy, str) and not is_java_blank(legacy):
        return (CoverLetterItem(question=LEGACY_QUESTION, answer=legacy),)
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_ITEMS:
        raise InvalidCoverLetterError(f"coverLetterItems는 문항 1~{MAX_ITEMS}개 배열이어야 한다")
    items = []
    for i, item in enumerate(value):
        if not isinstance(item, dict):
            raise InvalidCoverLetterError(f"coverLetterItems[{i}]는 JSON 객체여야 한다")
        items.append(
            CoverLetterItem(question=_text(item, "question", i), answer=_text(item, "answer", i))
        )
    return tuple(items)


def cover_letter_text(items: Sequence[CoverLetterItem]) -> str:
    """프롬프트에 넣을 자기소개서 글이다. 문항마다 질문 줄 다음에 답변을 두고 빈 줄로 나눈다.

    문항 배열로 새로 쓴 자기소개서는 이전 글 하나(문항 제목 줄 + 답변을 빈 줄로 이음)와
    같은 모양이라 결과 생성 프롬프트 버전을 바꾸지 않는다.
    이전 글 하나를 옮긴 문항(BE 마이그레이션·이전 메시지)은 '자기소개서' 질문 줄이 앞에 붙는다.
    """
    return "\n\n".join(f"{item.question}\n{item.answer}" for item in items)


def as_json(items: Sequence[CoverLetterItem]) -> list[dict[str, str]]:
    """BE가 보낸 모양 그대로 다시 보낼 때 쓴다(Jev state 등)."""
    return [{"question": item.question, "answer": item.answer} for item in items]
