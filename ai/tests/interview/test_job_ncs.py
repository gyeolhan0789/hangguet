import pytest
from company_taxonomy.ncs import NCS_SUBCATEGORIES

from app.interview.job_ncs import (
    COMPETENCY_UNITS,
    JOB_GROUPS,
    competency_units,
    job_subcategories,
)

BACKEND = ("응용SW엔지니어링", "SW아키텍처", "DB엔지니어링")
FRONTEND = ("UI/UX엔지니어링", "응용SW엔지니어링")


@pytest.mark.parametrize(
    ("job_title", "expected"),
    [
        ("백엔드 개발자", BACKEND),
        ("Spring 서버 개발", BACKEND),
        ("Back-End Engineer", BACKEND),
        ("프론트엔드 개발자", FRONTEND),
        ("웹 퍼블리셔", FRONTEND),
        ("iOS 개발자", ("응용SW엔지니어링", "UI/UX엔지니어링")),
        (
            "AI 엔지니어",
            ("인공지능모델링", "인공지능서비스구현", "인공지능플랫폼구축", "생성형AI엔지니어링"),
        ),
        (
            "데이터 엔지니어",
            ("빅데이터분석", "빅데이터플랫폼구축", "데이터아키텍처", "빅데이터운영·관리"),
        ),
        (
            "DevOps 엔지니어",
            (
                "클라우드인프라스트럭쳐엔지니어링",
                "클라우드솔루션아키텍처",
                "인프라스트럭쳐아키텍처구축",
                "IT시스템관리",
                "NW엔지니어링",
            ),
        ),
        (
            "C++ 임베디드",
            ("임베디드SW엔지니어링", "시스템SW엔지니어링", "IoT시스템연동", "온디바이스AIoT"),
        ),
        (
            "정보보호 담당",
            ("보안엔지니어링", "정보보호관리·운영", "정보보호진단·분석", "보안사고분석대응"),
        ),
        ("QA 엔지니어", ("IT테스트", "IT품질보증")),
        ("DBA", ("DB엔지니어링", "데이터아키텍처")),
        ("IT 기획", ("정보기술기획", "SW제품기획", "IT프로젝트관리")),
        ("기술 지원", ("IT기술지원", "IT시스템관리")),
    ],
)
def test_job_title_maps_to_its_group_subcategories(
    job_title: str, expected: tuple[str, ...]
) -> None:
    assert job_subcategories(job_title) == expected


def test_title_matching_several_groups_uses_all_without_duplicates() -> None:
    """풀스택은 백엔드·프론트엔드 묶음에 모두 해당하고, 겹치는 세분류는 한 번만 사용한다."""
    assert job_subcategories("풀스택 개발자") == (*BACKEND, "UI/UX엔지니어링")


@pytest.mark.parametrize(
    "job_title",
    [
        "마케팅",
        "인사 담당자",
        "",
        # 영문 짧은 단어는 다른 영문 단어 안에 포함된 경우 해당하지 않는다(email의 ai, html의 ml)
        "email 마케터",
        "html",
    ],
)
def test_title_without_group_maps_to_nothing(job_title: str) -> None:
    assert job_subcategories(job_title) == ()


def test_groups_use_only_ncs_information_technology_subcategories() -> None:
    names = {name for group in JOB_GROUPS for name in group.subcategories}

    assert names <= set(NCS_SUBCATEGORIES)
    assert set(COMPETENCY_UNITS) == names


def test_competency_units_follow_subcategory_order_without_duplicates() -> None:
    units = competency_units(("DB엔지니어링", "데이터아키텍처", "DB엔지니어링"))

    assert units == (*COMPETENCY_UNITS["DB엔지니어링"], *COMPETENCY_UNITS["데이터아키텍처"])
    assert competency_units(()) == ()
