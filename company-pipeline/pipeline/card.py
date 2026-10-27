"""③ 카드 요약: 인재상·사업 방향·경쟁·시장·최근 이슈를 LLM으로 요약하고 원문을 인용하게 한다."""

import json
import os
import re
import urllib.request
from collections import Counter
from datetime import date
from typing import Any

from pipeline.verify import normalize

PROMPT_VERSION = "card-v4"
INPUT_LIMIT = 6000
NEWS_EVENTS = 12  # 최근 이슈 입력에 넣는 사건 묶음 수 (큰 것부터). 16개부터 반복 오류가 났다
MAX_OUTPUT_TOKENS = 1500
REASONING_TOKENS = 2000  # gpt-5 계열 추론 몫

# card-v1은 '사업의 개요' + '기타 참고사항' 앞부분만 넣어서, 회사 계획 문장(보통 2만~3만 자 뒤
# 사업부문별 현황)이 빠지고 시장 전망·ESG 문장이 방향으로 뽑혔다. 그래서 '사업의 내용' 전체에서
# 계획·강화 표현이 있는 문장만 후보로 골라 넣는다.
_PLAN = re.compile(
    r"계획|예정|나갈 것|목표로|추진|주력|집중|모색|도모|선도|(강화|확대|확장)(하고|해|할)"
)
# 계획 표현이 있어도 면접용 회사 방향이 아닌 문장 (ESG·인증, 환율·금리 같은 재무 위험 관리)
_SKIP = re.compile(
    r"탄소|온실가스|RE100|Net ?Zero|ESG|기후|안전보건|환경(경영|보호|규제|영향)|폐가전"
    r"|인증|정보보호|리스크|위험|환율|통화|금리|차입|이자|대손|보안"
)

SYSTEM = (
    "너는 회사 자료를 면접 준비용 카드로 요약한다. 주어진 원문에 없는 내용은 쓰지 않는다.\n"
    "- talent: 인재상 원문에서 회사가 바라는 인재의 특징 1~3개\n"
    "- direction: 사업보고서 후보 문장 중 회사가 앞으로 집중·강화하려는 방향 1~3개. "
    "회사의 핵심 사업과 관련된 것을 고르고, 시장 전망이나 지난 실적만 있는 문장은 고르지 않는다\n"
    "- quote: 근거가 된 후보 문장을 한 글자도 바꾸지 말고 그대로 옮긴다\n"
    "- keyword·summary: quote에 적힌 내용만 짧게 다시 쓴다. "
    "quote에 없는 목적·원인·효과를 덧붙이지 않는다\n"
    "- 원문이 비어 있으면 그 항목은 빈 배열로 둔다\n"
    'JSON으로만 답한다: {"talent": [{"keyword": str, "quote": str}], '
    '"direction": [{"summary": str, "quote": str}]}'
)


# 경쟁·시장: 회사의 시장 위치, 주요 고객, 경쟁 요소. 한 번에 넣으면 입력이 1만 자를 넘어
# 로컬 모델 문맥(10240 토큰)에 빠듯해서 따로 호출한다
_MARKET = re.compile(
    r"점유율|경쟁사|경쟁 ?우위|경쟁 ?요소|경쟁력|시장 ?지위|선두|1위|주요 ?고객|매출처|거래처"
)
MARKET_SYSTEM = (
    "너는 회사 자료를 면접 준비용 카드로 요약한다. 주어진 원문에 없는 내용은 쓰지 않는다.\n"
    "- market: 사업보고서 후보 문장 중 이 회사의 경쟁 위치를 보여주는 것 1~3개. "
    "시장 점유율·순위, 주요 고객, 경쟁사 대비 강점, 이 회사 사업의 경쟁 요소를 고른다. "
    "회사와 관계없는 업계 일반 설명이나 규제 설명은 고르지 않는다\n"
    "- quote: 근거가 된 후보 문장을 한 글자도 바꾸지 말고 그대로 옮긴다\n"
    "- summary: quote의 단어로 20자 안팎 명사구를 만든다. quote에 없는 숫자·해석을 쓰지 않는다\n"
    "- 고를 문장이 없으면 빈 배열로 둔다\n"
    'JSON으로만 답한다: {"market": [{"summary": str, "quote": str}]}'
)


def _pick(business: str, pattern: re.Pattern[str]) -> str:
    """'사업의 내용'에서 pattern에 맞는 문장만 한 줄에 하나씩, 앞에서부터 INPUT_LIMIT자까지."""
    sentences = (s.strip() for s in re.split(r"(?<=다\.)|\n", business))
    picked = [s for s in sentences if len(s) >= 25 and pattern.search(s) and not _SKIP.search(s)]
    return "\n".join(picked)[:INPUT_LIMIT]


def business_input(business: str) -> str:
    return _pick(business, _PLAN)


def market_input(business: str) -> str:
    return _pick(business, _MARKET)


def build_messages(name: str, talent_text: str, business_text: str) -> list[dict[str, str]]:
    user = f"회사: {name}\n\n[인재상 원문]\n{talent_text}\n\n[사업보고서 문장]\n{business_text}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def build_market_messages(name: str, market_text: str) -> list[dict[str, str]]:
    user = f"회사: {name}\n\n[사업보고서 문장]\n{market_text}"
    return [{"role": "system", "content": MARKET_SYSTEM}, {"role": "user", "content": user}]


# 최근 이슈: news.py가 규칙으로 거르고 같은 사건끼리 묶은(group) 기사에서 묶음마다 1건만 넣는다.
# 8B 모델에 '같은 사건은 하나만'이라고 시키면 지키지 못해서 묶기는 임베딩으로 했다.
# 남은 주가·연예·일정 기사를 빼는 판단은 모델에 맡긴다
RECENT_SYSTEM = (
    "너는 회사 자료를 면접 준비용 카드로 요약한다. 주어진 원문에 없는 내용은 쓰지 않는다.\n"
    "- recent: 최근 기사 중 이 회사의 사업·제품·투자·전략·조직 변화를 보여주는 이슈 1~3개. "
    "기사 수가 많을수록 크게 다뤄진 이슈다. "
    "주가·증권사 전망, 연예·인물 이야기, 이벤트, 다른 회사가 주인공인 기사는 고르지 않는다\n"
    "- quote: 고른 기사의 제목이나 요약 한 줄을 한 글자도 바꾸지 말고 그대로 옮긴다\n"
    "- summary: quote의 단어로 20자 안팎 명사구를 만든다. quote에 없는 숫자·해석을 쓰지 않는다\n"
    "- 고를 기사가 없으면 빈 배열로 둔다\n"
    'JSON으로만 답한다: {"recent": [{"summary": str, "quote": str}]}'
)


def news_input(articles: list[dict[str, Any]]) -> str:
    """같은 사건 묶음마다 최신 기사 1건: '[날짜 · 기사 N건] 제목' 줄과 요약 줄.

    큰 묶음부터 NEWS_EVENTS개까지만 넣는다. 카카오 기사가 32묶음으로 쌓이자 6000자에서 기사
    중간이 잘린 입력에 모델이 같은 말을 반복하다 멈췄다("token repeat limit", 2026-10-22).
    """
    sizes = Counter(a.get("group") for a in articles)
    firsts = {a.get("group", n): a for n, a in reversed(list(enumerate(articles)))}.values()
    biggest = sorted(firsts, key=lambda a: -sizes[a.get("group")])[:NEWS_EVENTS]
    return "\n".join(
        f"[{a['published']} · 기사 {sizes[a.get('group')]}건] {a['title']}\n{a['summary']}"
        for a in biggest
    )


def build_recent_messages(name: str, news_text: str) -> list[dict[str, str]]:
    user = f"회사: {name}\n\n[최근 기사]\n{news_text}"
    return [{"role": "system", "content": RECENT_SYSTEM}, {"role": "user", "content": user}]


def link_articles(
    recent: list[dict[str, Any]], articles: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """인용이 들어 있는 기사를 찾아 그 기사의 링크·날짜와 같은 사건 기사 수를 붙인다.

    같은 묶음(사건)의 기사가 둘 이상 뽑히면 먼저 나온 것만 남긴다.
    """
    sizes = Counter(a.get("group") for a in articles)
    linked, seen = [], set()
    for item in recent:
        quote = normalize(str(item.get("quote", "")))
        found = next((a for a in articles if quote in normalize(a["title"] + a["summary"])), None)
        if quote and found and found.get("group") not in seen:
            seen.add(found.get("group"))
            source = {"source": found["url"], "published": found["published"]}
            linked.append({**item, **source, "articles": sizes[found.get("group")]})
    return linked


def parse_reply(content: str) -> dict[str, Any]:
    """모델이 앞에 붙이는 <think> 블록을 지우고 JSON을 읽는다."""
    result: dict[str, Any] = json.loads(re.sub(r"<think>.*?</think>", "", content, flags=re.S))
    return result


def call_llm(messages: list[dict[str, str]]) -> dict[str, Any]:
    """OpenAI 호환 chat completions 호출. 로컬(Ollama)과 GMS 모두 환경변수만 바꿔 쓴다."""
    payload: dict[str, Any] = {
        "model": os.environ["LLM_MODEL"],
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0,
        # 모델이 같은 말을 끝없이 반복하면 5분 시간 초과까지 기다렸다(카카오, 2026-10-22).
        # 카드 응답은 길어야 수백 토큰이라 넘으면 바로 끊는다(잘린 JSON은 파싱 오류로 실패)
        "max_tokens": MAX_OUTPUT_TOKENS,
    }
    if effort := os.environ.get("LLM_REASONING_EFFORT"):
        payload["reasoning_effort"] = effort
    if payload["model"].startswith("gpt-5"):
        # gpt-5 계열은 temperature 고정 불가, 출력 제한 이름이 다르고 추론 토큰도 여기에 포함된다
        del payload["temperature"], payload["max_tokens"]
        payload["max_completion_tokens"] = MAX_OUTPUT_TOKENS + REASONING_TOKENS
    headers = {"Content-Type": "application/json"}
    if key := os.environ.get("LLM_API_KEY"):
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(
        os.environ["LLM_CHAT_URL"], data=json.dumps(payload).encode(), headers=headers
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        content = json.loads(res.read())["choices"][0]["message"]["content"]
    return parse_reply(content)


def to_card(
    llm: dict[str, Any], *, corp_code: str, name: str, talent_source: str, report_source: str
) -> dict[str, Any]:
    return {
        "corp_code": corp_code,
        "name": name,
        "generated_at": date.today().isoformat(),
        "prompt_version": PROMPT_VERSION,
        "model": os.environ.get("LLM_MODEL", ""),
        "talent": [{**t, "source": talent_source} for t in llm.get("talent", [])],
        "direction": [{**d, "source": report_source} for d in llm.get("direction", [])],
        "market": [{**m, "source": report_source} for m in llm.get("market", [])],
        "recent": llm.get("recent", []),  # 출처(기사 링크)는 link_articles가 붙인다
    }
