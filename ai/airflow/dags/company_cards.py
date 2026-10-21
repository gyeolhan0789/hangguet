"""회사 카드 파이프라인 DAG. 작업 내용은 ai/pipeline 코드를 그대로 부른다.

- company_news_daily: 매일 13:00(KST) 회사별 기사 수집 → 최근 이슈 갱신 → 확인 화면 데이터 갱신
- company_cards_full: 수동 실행. 회사별 기사 수집 → 카드 전체 생성 (프롬프트·보고서 변경, 회사 추가)
"""

import json
from datetime import timedelta

import pendulum
from airflow.sdk import dag, get_current_context, task

from pipeline import news, run, viewer

COMPANIES = run.HERE / "companies.json"
RETRY = {"retries": 2, "retry_delay": timedelta(minutes=5)}
# 회사별 작업 이름을 map 번호 대신 회사명으로 보이게 한다
BY_NAME = "{{ company_name }}"


def _name(company: dict[str, str]) -> str:
    get_current_context()["company_name"] = company["name"]
    return company["name"]


@task
def companies() -> list[dict[str, str]]:
    return json.loads(COMPANIES.read_text(encoding="utf-8"))


# 기사 묶기(임베딩)도 Ollama를 써서 같은 풀로 줄 세운다. 11곳이 동시에 몰리면
# Ollama 임베딩이 400, 네이버 검색 API가 429를 냈다(2026-10-21 첫 실행)
@task(map_index_template=BY_NAME, pool="llm", **RETRY)
def collect_news(company: dict[str, str]) -> dict[str, str]:
    print(f"{_name(company)}: 기사 {len(news.collect(company, run.DATA))}건")
    return company


# GPU가 하나라 Ollama를 쓰는 작업은 llm 풀(크기 1)로 한 번에 하나씩
@task(map_index_template=BY_NAME, pool="llm", **RETRY)
def refresh_recent(company: dict[str, str]) -> str:
    _name(company)
    return str(run.refresh_recent(company))


@task(map_index_template=BY_NAME, pool="llm", **RETRY)
def build_card(company: dict[str, str]) -> str:
    _name(company)
    return str(run.build_one(company))


# 일부 회사가 실패해도 성공한 카드로 확인 화면을 갱신한다
@task(trigger_rule="all_done")
def write_viewer() -> str:
    return str(viewer.write(run.DATA))


@dag(
    schedule="0 13 * * *",  # 노트북이 켜져 있는 점심시간
    start_date=pendulum.datetime(2026, 10, 21, tz="Asia/Seoul"),
    catchup=False,  # 노트북이 꺼져 있던 날은 몰아서 돌리지 않는다
    tags=["company-card"],
)
def company_news_daily() -> None:
    refreshed = refresh_recent.expand(company=collect_news.expand(company=companies()))
    refreshed >> write_viewer()


@dag(
    schedule=None,
    start_date=pendulum.datetime(2026, 10, 21, tz="Asia/Seoul"),
    tags=["company-card"],
)
def company_cards_full() -> None:
    # 새 회사도 최근 이슈가 채워지게 기사를 먼저 모은다
    build_card.expand(company=collect_news.expand(company=companies())) >> write_viewer()


company_news_daily()
company_cards_full()
