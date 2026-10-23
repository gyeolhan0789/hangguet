from datetime import date

from pipeline.news import group, merge, select

TODAY = date(2026, 10, 21)


def _item(title: str, pub: str, link: str = "https://n.news.naver.com/a") -> dict[str, str]:
    # 네이버 뉴스 검색 API 응답 항목 형식 (검색어는 <b>로 감싸고 따옴표는 &quot;로 온다)
    return {
        "title": title,
        "originallink": "",
        "link": link,
        "description": "<b>카카오</b>가 &quot;AI 에이전트&quot; 생태계를 넓힌다.",
        "pubDate": pub,
    }


def test_select_keeps_recent_company_news_only() -> None:
    response = {
        "items": [
            _item("<b>카카오</b>, 카나나 정식 출시", "Mon, 20 Oct 2026 09:00:00 +0900"),
            _item("<b>카카오</b>, 카나나 정식 출시", "Mon, 20 Oct 2026 08:00:00 +0900"),
            _item("[특징주] <b>카카오</b> 급등", "Mon, 20 Oct 2026 10:00:00 +0900"),
            _item("<b>카카오</b> 데이터센터 착공", "Mon, 01 Sep 2026 09:00:00 +0900"),
            _item("AI 에이전트 경쟁 본격화", "Mon, 20 Oct 2026 09:00:00 +0900"),
        ]
    }
    picked = select(response, "카카오", TODAY)
    # 같은 제목 하나만, 시황 기사·30일 지난 기사·제목에 회사 이름 없는 기사는 뺀다
    assert [p["title"] for p in picked] == ["카카오, 카나나 정식 출시"]
    assert picked[0]["summary"] == '카카오가 "AI 에이전트" 생태계를 넓힌다.'
    assert picked[0]["published"] == "2026-10-20"
    assert picked[0]["url"] == "https://n.news.naver.com/a"  # 원문 링크가 없으면 네이버 링크


def test_select_noise_rules_from_real_titles() -> None:
    # 2026-10-21 실제 수집에서 잘못 남거나 잘못 버려졌던 제목
    pub = "Tue, 21 Oct 2026 09:00:00 +0900"
    titles = {
        "카카오뱅크 AI 이모지 퀴즈 정답 (10월 21일)": False,
        "삼성전자 4%·SK하이닉스 5%대 반등": False,
        "현대차증권 권유 펀드에 151억 원 손실": False,
        "카카오뱅크, 코스피200 연계 ELB 펀드 출시": True,
        "[속보]삼성전자 3.8%↑ SK하이닉스 5.9%↑ 출발": False,
        "KB證 “마이크론 파업 예고⋯삼성전자 반사이익 기대”": False,
        "류재철 LG전자 대표 “냉각 기술, 전력 효율성↑”": True,
    }
    response = {"items": [_item(t, pub) for t in titles]}
    kept = {p["title"] for p in select(response, "", TODAY)}
    assert kept == {t for t, keep in titles.items() if keep}


def test_merge_accumulates_and_drops_old() -> None:
    old = [
        {
            "title": "카카오, 카나나 출시",
            "summary": "옛 요약",
            "url": "a",
            "published": "2026-10-19",
        },
        {"title": "카카오, 9월 기사", "summary": "", "url": "b", "published": "2026-09-01"},
    ]
    new = [
        {
            "title": "카카오, 카나나 출시!",
            "summary": "새 요약",
            "url": "c",
            "published": "2026-10-20",
        },
        {"title": "카카오, 새 기사", "summary": "", "url": "d", "published": "2026-10-21"},
    ]
    merged = merge(old, new, TODAY)
    # 문장부호만 다른 같은 제목은 새 것, 30일 지난 기사는 버림, 최신순
    assert [m["url"] for m in merged] == ["d", "c"]


def test_group_compares_with_group_leader_only() -> None:
    # 1은 0과 비슷(0.99)해 같은 묶음. 2는 1과 비슷(0.71)해도 묶음 첫 기사 0과 0.6이라 새 묶음
    # (비슷한 쌍을 모두 이으면 0~1~2가 번져 한 묶음이 된다)
    vectors = [[1.0, 0.0, 0.0], [0.99, 0.14, 0.0], [0.6, 0.8, 0.0], [0.0, 0.0, 1.0]]
    assert group(vectors, threshold=0.7) == [0, 0, 1, 2]
