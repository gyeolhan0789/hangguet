"""회사 카드 파이프라인 DAG. 작업 내용은 company-pipeline/pipeline 코드를 그대로 부른다.

- company_news_daily: 매일 13:00(KST) 회사별 기사 수집 → 최근 이슈 갱신
  → 확인 화면 데이터 갱신·카드 올리기
- company_cards_full: 수동 실행. 회사별 기사 수집 → 카드 전체 생성 (프롬프트·보고서 변경, 회사 추가)
  → 확인 화면 데이터 갱신·카드 올리기
- company_cards_classify: 수동 실행. 저장된 카드에서 분류값이 없는 항목만 채움
  → 확인 화면 데이터 갱신·카드 올리기
"""

import json
from datetime import timedelta

import pendulum
from airflow.sdk import dag, get_current_context, task

from pipeline import candidates, news, publish, run, viewer

RETRY = {"retries": 2, "retry_delay": timedelta(minutes=5)}
# 회사별 작업 이름을 map 번호 대신 회사명으로 보이게 한다
BY_NAME = "{{ company_name }}"


def _name(company: dict[str, str]) -> str:
    get_current_context()["company_name"] = company["name"]
    return company["name"]


@task
def companies() -> list[dict[str, str]]:
    # 서버는 COMPANIES_PATH(확인 화면에서 추가한 회사가 들어가는 data/ 아래 파일)를 읽는다
    return json.loads(candidates.companies_file().read_text(encoding="utf-8"))


# 기사 묶기(임베딩)도 같은 풀로 줄 세운다. 여러 회사가 동시에 몰리면
# 임베딩이 400, 네이버 검색 API가 429를 낸다
@task(map_index_template=BY_NAME, pool="llm", **RETRY)
def collect_news(company: dict[str, str]) -> dict[str, str]:
    print(f"{_name(company)}: 기사 {len(news.collect(company))}건")
    return company


# LLM을 부르는 작업은 llm 풀(크기 1)로 한 번에 하나씩
@task(map_index_template=BY_NAME, pool="llm", **RETRY)
def refresh_recent(company: dict[str, str]) -> str:
    _name(company)
    return str(run.refresh_recent(company))


@task(map_index_template=BY_NAME, pool="llm", **RETRY)
def build_card(company: dict[str, str]) -> str:
    _name(company)
    return str(run.build_one(company))


# 이미 분류값이 있는 항목은 건너뛰므로 다시 시도해도 분류된 값이 변경되지 않는다
@task(pool="llm", **RETRY)
def fill_classification() -> list[str]:
    return [str(path) for path in run.fill_classification()]


# 일부 회사가 실패해도 성공한 카드로 확인 화면을 갱신한다
@task(trigger_rule="all_done")
def write_viewer() -> str:
    return str(viewer.write(run.DATA))


# 일부 회사가 실패해도 성공한 카드는 BE가 읽는 공용 버킷에 올린다(카드 → manifest 순서)
@task(trigger_rule="all_done", **RETRY)
def publish_cards() -> str:
    return publish.publish(run.DATA)


# 회사별 작업이 하나라도 실패하면 실행 전체를 실패로 표시한다. 마지막 작업(write_viewer)이
# all_done이라 이게 없으면 회사 작업이 다시 시도까지 모두 실패해도 실행이 성공으로 보인다
@task
def all_companies_ok() -> None:
    pass


@dag(
    schedule="0 13 * * *",
    start_date=pendulum.datetime(2026, 10, 21, tz="Asia/Seoul"),
    catchup=False,  # 서버가 꺼져 있던 날은 몰아서 돌리지 않는다
    tags=["company-card"],
)
def company_news_daily() -> None:
    refreshed = refresh_recent.expand(company=collect_news.expand(company=companies()))
    refreshed >> [write_viewer(), publish_cards(), all_companies_ok()]


@dag(
    schedule=None,
    start_date=pendulum.datetime(2026, 10, 21, tz="Asia/Seoul"),
    tags=["company-card"],
)
def company_cards_full() -> None:
    # 새 회사도 최근 이슈가 채워지게 기사를 먼저 모은다
    built = build_card.expand(company=collect_news.expand(company=companies()))
    built >> [write_viewer(), publish_cards(), all_companies_ok()]


@dag(
    schedule=None,
    start_date=pendulum.datetime(2026, 10, 21, tz="Asia/Seoul"),
    tags=["company-card"],
)
def company_cards_classify() -> None:
    fill_classification() >> [write_viewer(), publish_cards()]


company_news_daily()
company_cards_full()
company_cards_classify()
