import json

import pytest

from app.common.cover_letter import CoverLetterItem
from app.interview.cover_letter import (
    JEV_MODEL,
    JEV_TIMEOUT_SECONDS,
    USABLE_QUESTION,
    CoverLetterChecker,
    CoverLetterCheckError,
    check_questions,
    usable_from,
)

# 기준: AI 명세 2.1 자기소개서 검증(Jev noul 0.5 이상이면 통과, 판단하지 못하면 실패)


ITEMS = (CoverLetterItem("지원 동기", "저는 …"), CoverLetterItem("협업 경험", "함께 …"))


def answers(noul: object) -> dict[str, object]:
    return {"answers": {USABLE_QUESTION: {"noul": noul}}}


def test_request_has_company_job_and_cover_letter_with_one_question() -> None:
    sent: list[tuple[dict[str, object], float]] = []

    def post(data: bytes, timeout: float) -> object:
        sent.append((json.loads(data), timeout))
        return answers(0.9)

    assert CoverLetterChecker("key", post=post).check("○○전자", "백엔드", ITEMS) is True
    body, timeout = sent[0]
    # 문항은 BE가 보낸 모양(질문 · 답변) 그대로 순서대로 넘긴다
    assert body == {
        "model": JEV_MODEL,
        "state": {
            "companyName": "○○전자",
            "jobTitle": "백엔드",
            "coverLetterItems": [
                {"question": "지원 동기", "answer": "저는 …"},
                {"question": "협업 경험", "answer": "함께 …"},
            ],
        },
        "questions": check_questions(),
    }
    assert "coverLetterItems" in check_questions()[USABLE_QUESTION]["instructions"]
    assert timeout == JEV_TIMEOUT_SECONDS
    assert check_questions()[USABLE_QUESTION]["type"] == "noul"


@pytest.mark.parametrize(("noul", "usable"), [(0.5, True), (0.49, False), (0, False), (1, True)])
def test_usable_at_or_above_threshold(noul: float, usable: bool) -> None:
    assert usable_from(answers(noul)["answers"]) is usable


@pytest.mark.parametrize(
    "response",
    [None, [], {}, {"answers": {}}, answers("0.9"), answers(True), answers(None)],
)
def test_unreadable_response_is_an_error(response: object) -> None:
    checker = CoverLetterChecker("key", post=lambda data, timeout: response)
    with pytest.raises(CoverLetterCheckError):
        checker.check("회사", "직무", ITEMS)
