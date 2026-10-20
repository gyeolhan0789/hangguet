import pytest

from pipeline.extract import business_section, to_text

# 실제 사업보고서의 제목 태그 구조를 줄여 만든 샘플.
# 본문 안에 'III. 재무에 관한 사항'을 참고하라는 문장이 있어도 거기서 잘리면 안 된다.
REPORT = """
<SECTION-1><TITLE ATOC="Y" AASSOCNOTE="D-0-1-0-0">I. 회사의 개요</TITLE>
<P>설립 1990년</P></SECTION-1>
<SECTION-1><TITLE ATOC="Y" AASSOCNOTE="D-0-2-0-0">II. 사업의 내용</TITLE>
<SECTION-2><TITLE ATOC="Y" AASSOCNOTE="L-0-2-1-L1">1. 사업의 개요</TITLE>
<P>당사는 기존 결제 서비스의&nbsp;안정화와 수익화에 집중하고 있습니다.</P>
<P>자세한 내용은 'III. 재무에 관한 사항'을 참고하시기 바랍니다.</P></SECTION-2>
<SECTION-2><TITLE ATOC="Y" AASSOCNOTE="L-0-2-2-L1">2. 주요 제품 및 서비스</TITLE>
<P>간편결제</P></SECTION-2></SECTION-1>
<SECTION-1><TITLE ATOC="Y" AASSOCNOTE="D-0-3-0-0">III. 재무에 관한 사항</TITLE>
<P>매출</P></SECTION-1>
"""


def test_business_section_cuts_at_next_chapter_title() -> None:
    section = business_section(REPORT)
    assert section.splitlines()[0] == "II. 사업의 내용"
    assert "안정화와 수익화에 집중" in section  # &nbsp;는 공백으로
    assert "2. 주요 제품 및 서비스" in section  # 본문 속 'III.' 문장에서 잘리지 않음
    assert "설립" not in section
    assert "매출" not in section


def test_business_section_missing() -> None:
    with pytest.raises(LookupError):
        business_section("<TITLE AASSOCNOTE='D-0-1-0-0'>I. 회사의 개요</TITLE>")


def test_to_text_drops_tags_and_blank_lines() -> None:
    assert to_text("<P>  가 \t 나 </P>\n\n<P></P><P>다</P>") == "가 나\n다"
