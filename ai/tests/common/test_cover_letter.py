"""자기소개서 문항(API 명세 4.1 coverLetterItems) 읽기와 프롬프트용 글을 확인한다."""

from typing import Any

import pytest

from app.common.cover_letter import (
    MAX_ITEMS,
    CoverLetterItem,
    InvalidCoverLetterError,
    as_json,
    cover_letter_text,
    parse_cover_letter_items,
)

A = CoverLetterItem("지원 동기", "답1")
B = CoverLetterItem("협업 경험", "답2")


def item(question: Any = "문항", answer: Any = "답변") -> dict[str, Any]:
    return {"question": question, "answer": answer}


def test_text_puts_question_line_before_answer_and_joins_items_with_blank_line() -> None:
    assert cover_letter_text((A, B)) == "지원 동기\n답1\n\n협업 경험\n답2"


@pytest.mark.parametrize("count", [1, MAX_ITEMS])
def test_parses_one_to_five_items(count: int) -> None:
    items = parse_cover_letter_items([item(f"문항 {i}", f"답변 {i}") for i in range(count)])

    assert items == tuple(CoverLetterItem(f"문항 {i}", f"답변 {i}") for i in range(count))


@pytest.mark.parametrize("count", [0, MAX_ITEMS + 1])
def test_item_count_out_of_range_is_invalid(count: int) -> None:
    with pytest.raises(InvalidCoverLetterError, match="coverLetterItems"):
        parse_cover_letter_items([item()] * count)


@pytest.mark.parametrize("value", [None, "자소서", {"question": "문항", "answer": "답변"}])
def test_non_array_is_invalid(value: Any) -> None:
    with pytest.raises(InvalidCoverLetterError, match="coverLetterItems"):
        parse_cover_letter_items(value)


@pytest.mark.parametrize("value", [["문항", "답변"], "문항", None])
def test_non_object_item_is_invalid(value: Any) -> None:
    with pytest.raises(InvalidCoverLetterError, match=r"coverLetterItems\[1\]"):
        parse_cover_letter_items([item(), value])


@pytest.mark.parametrize("value", ["", "  ", "　", 7, None])
@pytest.mark.parametrize("field", ["question", "answer"])
def test_blank_question_or_answer_is_invalid(field: str, value: Any) -> None:
    with pytest.raises(InvalidCoverLetterError, match=rf"coverLetterItems\[0\]\.{field}"):
        parse_cover_letter_items([{**item(), field: value}])


def test_as_json_keeps_be_shape_and_order() -> None:
    assert as_json((A, B)) == [
        {"question": "지원 동기", "answer": "답1"},
        {"question": "협업 경험", "answer": "답2"},
    ]
