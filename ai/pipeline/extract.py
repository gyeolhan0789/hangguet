"""② 본문 추출: 사업보고서 원문에서 "II. 사업의 내용"만 텍스트로 꺼낸다."""

import html
import re

# DART 원문의 대단원 제목은 AASSOCNOTE="D-0-{번호}-0-0"으로 표시된다.
# 본문 문장 안에도 'III. 재무에 관한 사항'을 참고하라는 글이 많아서,
# 제목 글자 대신 이 속성으로 자른다.
_START = re.compile(r'<TITLE[^>]*AASSOCNOTE="D-0-2-0-0"[^>]*>')
_END = re.compile(r'<TITLE[^>]*AASSOCNOTE="D-0-(?:[3-9]|\d{2})-0-0"[^>]*>')
_TAG = re.compile(r"<[^>]+>")


def to_text(markup: str) -> str:
    """태그를 지우고 공백을 정리한다.

    DART 원문은 XML 형식이 깨진 경우가 있어 파서 대신 정규식을 쓴다.
    """
    text = html.unescape(_TAG.sub("\n", markup))
    lines = (re.sub(r"[ \t ]+", " ", line).strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def business_section(markup: str) -> str:
    """'II. 사업의 내용' 제목부터 다음 대단원(III.) 제목 직전까지를 텍스트로 돌려준다."""
    start = _START.search(markup)
    if not start:
        raise LookupError("'II. 사업의 내용' 제목을 찾지 못했다")
    end = _END.search(markup, start.end())
    return to_text(markup[start.start() : end.start() if end else len(markup)])
