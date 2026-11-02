import json
from pathlib import Path

import pytest

from pipeline import candidates, card
from pipeline.candidates import (
    Corp,
    InvalidListError,
    add,
    ask_official,
    companies_file,
    corps,
    entry,
    find,
    key,
    match,
    replace,
    search,
    update,
    validate,
)

# 실제 DART 고유번호 목록 일부: 카카오(비상장·상장 동명), 삼성전자, 미래에셋자산운용(비상장)
CORPS = corps((Path(__file__).parent / "fixtures" / "corpcode_sample.xml").read_bytes())
MORE = [
    Corp("삼성에스디에스", "Samsung SDS Co.,Ltd.", "00126186", True),
    Corp("NAVER", "NAVER Corporation", "00266961", True),
    Corp("삼성물산", "SAMSUNG C&T CORPORATION", "00126229", True),
]


def names(found: list[Corp]) -> list[str]:
    return [c.name for c in found]


def test_key_ignores_spacing_and_company_suffix() -> None:
    assert key("삼성 전자(주)") == key("삼성전자") == "삼성전자"
    assert key("Samsung SDS Co.,Ltd.") == "samsungsds"


def test_match_exact_name_prefers_listed_company() -> None:
    corp, _ = match("카카오", CORPS)
    assert corp is not None and corp.code == "00258801"  # 비상장 동명 회사가 아니라 상장사


def test_corps_keeps_latest_of_same_name_listed() -> None:
    assert [c.code for c in CORPS if c.name == "SK"] == ["00181712"]
    assert match("SK", CORPS)[0].code == "00181712"  # type: ignore[union-attr]


def test_match_by_spacing_suffix_and_english_name() -> None:
    all_corps = CORPS + MORE
    assert match("삼성전자㈜", all_corps)[0] == match("삼성전자", all_corps)[0]
    assert match("naver", all_corps)[0] == MORE[1]
    assert match("Samsung SDS", all_corps)[0] == MORE[0]  # "삼성SDS"는 영문명으로 찾는다


def test_match_unlisted_company_when_only_one() -> None:
    corp, _ = match("미래에셋자산운용", CORPS)
    assert corp is not None and not corp.listed


def test_match_ambiguous_or_unknown_gives_suggestions() -> None:
    corp, similar = match("삼성", CORPS + MORE)
    assert corp is None
    assert set(names(similar)) == {"삼성전자", "삼성물산", "삼성에스디에스"}
    assert match("없는회사", CORPS) == (None, [])


def test_entry_keeps_typed_name_as_news_query() -> None:
    assert entry(MORE[0], "삼성SDS") == {
        "name": "삼성에스디에스",
        "news_query": "삼성SDS",
        "talent_url": "",
        "talent_text": "",
        "talent_collected_at": "",
    }
    assert "news_query" not in entry(MORE[1], "NAVER")


def test_ask_official_accepts_only_names_in_dart(monkeypatch: pytest.MonkeyPatch) -> None:
    # 실제 응답처럼 "주식회사"를 붙여도 맞추고, DART 목록에 없는 이름은 버린다
    reply = {"names": ["삼성SDS 주식회사", "삼성에스디에스 주식회사"]}
    monkeypatch.setattr(card, "call_llm", lambda messages: reply)
    assert ask_official("삼성SDS", CORPS + MORE) == MORE[0]

    monkeypatch.setattr(card, "call_llm", lambda messages: {"names": ["없는회사"]})
    assert ask_official("아무개", CORPS + MORE) is None


def test_ask_official_survives_llm_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(messages: object) -> dict[str, object]:
        raise OSError("HTTP Error 502: Bad Gateway")

    monkeypatch.setattr(card, "call_llm", broken)
    assert ask_official("삼성SDS", CORPS + MORE) is None


def test_add_appends_once(tmp_path: Path) -> None:
    companies = tmp_path / "companies.json"
    companies.write_text('[\n  {\n    "name": "카카오"\n  }\n]\n', encoding="utf-8")
    extra = {"news_query": "삼성SDS", "talent_collected_at": "2026-10-22"}
    add(MORE[0], extra, companies)

    rows = json.loads(companies.read_text(encoding="utf-8"))
    assert rows[-1] == {
        "name": "삼성에스디에스",
        "news_query": "삼성SDS",
        "talent_url": "",
        "talent_text": "",
        "talent_collected_at": "",  # 인재상 원문이 없으면 수집일도 비운다
    }
    with pytest.raises(ValueError):
        add(MORE[0], {}, companies)  # 이미 있는 회사


def test_update_changes_only_given_fields(tmp_path: Path) -> None:
    companies = tmp_path / "companies.json"
    old = {
        "name": "하이브",
        "news_query": "HYBE",
        "talent_url": "https://old",
        "talent_text": "하이브 DNA",
        "talent_collected_at": "2026-10-20",
    }
    companies.write_text(json.dumps([{"name": "카카오"}, old], ensure_ascii=False), "utf-8")

    row = update(
        "하이브", {"talent_text": " 새 원문 ", "talent_collected_at": "2026-10-29"}, companies
    )

    # 준 칸만 바뀌고 나머지(검색어·주소)는 그대로, 회사명도 그대로
    assert row == old | {"talent_text": "새 원문", "talent_collected_at": "2026-10-29"}
    assert find("하이브", companies) == row
    assert find("카카오", companies) == {"name": "카카오"}  # 다른 회사는 건드리지 않는다
    assert not (tmp_path / "companies.json.tmp").exists()  # 임시 파일은 바꿔 끼우고 남지 않는다


def test_update_clears_query_same_as_name_and_date_without_text(tmp_path: Path) -> None:
    companies = tmp_path / "companies.json"
    companies.write_text(json.dumps([{"name": "하이브", "news_query": "HYBE"}]), "utf-8")

    row = update("하이브", {"news_query": "하이브", "talent_collected_at": "2026-10-29"}, companies)

    assert "news_query" not in row  # 회사명과 같은 검색어는 넣지 않는다
    assert row["talent_collected_at"] == ""  # 인재상 원문이 없으면 수집일도 비운다


def test_update_cleans_aliases_and_drops_empty(tmp_path: Path) -> None:
    companies = tmp_path / "companies.json"
    companies.write_text(json.dumps([{"name": "삼성에스디에스"}], ensure_ascii=False), "utf-8")

    row = update("삼성에스디에스", {"aliases": " 삼성SDS,, SDS , 삼성SDS "}, companies)
    assert row["aliases"] == "삼성SDS, SDS"  # 공백·빈 이름·중복을 뺀다

    assert "aliases" not in update("삼성에스디에스", {"aliases": " , "}, companies)


def test_update_unknown_company(tmp_path: Path) -> None:
    companies = tmp_path / "companies.json"
    companies.write_text("[]", "utf-8")
    with pytest.raises(LookupError):
        update("없는회사", {"talent_text": "x"}, companies)
    assert find("없는회사", companies) is None


def test_validate_reports_every_problem() -> None:
    rows = [
        {"name": "카카오", "talent_txt": "오타 칸"},
        {"name": "카카오"},
        {"name": " "},
        "문자열 한 줄",
        {"name": "NAVER", "talent_text": 3},
        {"name": "없는회사"},
    ]
    with pytest.raises(InvalidListError) as e:
        validate(rows, known={"카카오", "NAVER"})
    assert e.value.errors == [
        "카카오: 모르는 칸 talent_txt",
        "카카오: 두 번 들어 있다",
        "3번째: name(회사명)이 없다",
        "4번째: name(회사명)이 없다",
        "NAVER: 문자열이 아닌 칸 talent_text",
        "없는회사: DART 목록에 없는 회사명",
    ]
    with pytest.raises(InvalidListError):
        validate({"name": "카카오"})  # 배열이 아님


def test_validate_cleans_rows_like_add() -> None:
    rows = [{"name": " NAVER ", "news_query": "NAVER", "talent_collected_at": "2026-10-29"}]
    assert validate(rows, known=None) == [
        {"name": "NAVER", "talent_url": "", "talent_text": "", "talent_collected_at": ""}
    ]


def test_replace_dry_run_then_replace_with_backup(tmp_path: Path) -> None:
    companies = tmp_path / "companies.json"
    companies.write_text(json.dumps([{"name": "카카오"}, {"name": "NAVER"}]), "utf-8")
    new = [{"name": "NAVER", "talent_text": "새 원문"}, {"name": "하이브"}]
    known = {"카카오", "NAVER", "하이브"}

    preview = replace(new, known, companies, dry_run=True)
    assert preview == {"count": 2, "added": ["하이브"], "removed": ["카카오"], "changed": ["NAVER"]}
    assert find("카카오", companies) is not None  # 확인만 하고 저장하지 않는다

    result = replace(new, known, companies)
    assert [r["name"] for r in json.loads(companies.read_text("utf-8"))] == ["NAVER", "하이브"]
    backup = tmp_path / result["backup"]
    assert json.loads(backup.read_text("utf-8")) == [{"name": "카카오"}, {"name": "NAVER"}]


def test_replace_keeps_file_when_invalid(tmp_path: Path) -> None:
    companies = tmp_path / "companies.json"
    companies.write_text('[{"name": "카카오"}]', "utf-8")
    with pytest.raises(InvalidListError):
        replace([{"name": "카카오"}, {"name": "카카오"}], None, companies)
    assert companies.read_text("utf-8") == '[{"name": "카카오"}]'
    assert list(tmp_path.glob("*.bak")) == []


def test_search_prefers_exact_and_listed() -> None:
    assert names(search("삼성", CORPS + MORE))[:1] == ["삼성전자"]
    assert names(search("samsung sds", CORPS + MORE)) == ["삼성에스디에스"]
    assert search(" ", CORPS) == []


def test_companies_file_uses_git_list_locally(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("COMPANIES_PATH", raising=False)
    assert companies_file().name == "companies.json"
    assert companies_file().parent.name == "pipeline"


def test_companies_file_on_server_starts_from_git_list_and_keeps_additions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 서버는 배포 때 덮어쓰지 않는 data/ 아래 파일을 쓴다. 처음에는 git 목록을 복사해 시작
    server = tmp_path / "data" / "companies.json"
    monkeypatch.setenv("COMPANIES_PATH", str(server))

    assert companies_file() == server
    seed = (Path(candidates.__file__).parent / "companies.json").read_text(encoding="utf-8")
    assert server.read_text(encoding="utf-8") == seed

    new = Corp("테스트회사", "Test Co.", "99999999", False)
    add(new, {})  # 화면에서 추가한 회사는 서버 파일에 남는다
    assert companies_file() == server  # 이미 있으면 다시 복사하지 않는다
    assert json.loads(server.read_text(encoding="utf-8"))[-1]["name"] == "테스트회사"
