"""③ 카드 요약: LLM으로 인재상·사업 방향을 요약하고 원문 문장을 인용하게 한다."""

import json
import os
import re
import urllib.request
from datetime import date
from typing import Any

PROMPT_VERSION = "card-v1"
OTHER_LIMIT = 6000  # '기타 참고사항'은 회사마다 2천~2만8천 자라 앞부분만 쓴다

SYSTEM = (
    "너는 회사 자료를 면접 준비용 카드로 요약한다. 주어진 원문에 없는 내용은 쓰지 않는다.\n"
    "- talent: 인재상 원문에서 회사가 바라는 인재의 특징 1~3개\n"
    "- direction: 사업보고서 원문에서 회사가 앞으로 집중·강화하려는 방향 1~3개. "
    "단순한 회사 소개, 매출 숫자, 안전·환경 규제는 고르지 않는다\n"
    "- quote: 근거가 된 원문 문장을 한 글자도 바꾸지 말고 그대로 옮긴다\n"
    "- 원문이 비어 있으면 그 항목은 빈 배열로 둔다\n"
    'JSON으로만 답한다: {"talent": [{"keyword": str, "quote": str}], '
    '"direction": [{"summary": str, "quote": str}]}'
)


def _between(text: str, start: str, end: str) -> str:
    """start 줄부터 그 뒤 처음 나오는 end 줄 직전까지. 하위 항목도 '1.'처럼 번호가 다시 매겨져서
    번호가 아니라 대단원 제목 글자로 끝을 찾는다."""
    head = re.search(start, text, re.M)
    if not head:
        return ""
    tail = re.search(end, text[head.end() :], re.M)
    return text[head.start() : head.end() + tail.start() if tail else len(text)]


def business_input(business: str) -> str:
    """'사업의 내용'에서 '1. 사업의 개요' 전체와 '기타 참고사항' 앞부분만 남긴다."""
    overview = _between(business, r"^1\. .*사업의 ?개요", r"^2\. .*(주요 ?제품|영업의 ?현황)")
    other = _between(business, r"^\d\. .*기타 ?참고사항", r"\Z")
    return f"{overview}\n{other[:OTHER_LIMIT]}".strip()


def build_messages(name: str, talent_text: str, business_text: str) -> list[dict[str, str]]:
    user = f"회사: {name}\n\n[인재상 원문]\n{talent_text}\n\n[사업보고서 원문]\n{business_text}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


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
    }
    if effort := os.environ.get("LLM_REASONING_EFFORT"):
        payload["reasoning_effort"] = effort
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
    }
