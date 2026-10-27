"""자기소개서로 면접 질문을 만들 수 있는지 Jev(POST /v1/systemone)로 판단한다.

기준: AI 명세 2.1 자기소개서 검증, 9장 버전.
- 의미 없는 글이거나 질문을 만들 만큼 경험·내용이 없으면 통과시키지 않는다.
  질문 생성(PLAN)이 면접방에 들어간 뒤에 실패하지 않도록 지원서를 저장하기 전에 막기 위해서다.
- 글자 수 기준을 따로 두지 않고 같은 질문으로 함께 판단한다.
- 판단하지 못하면(시간 초과·호출 실패·응답 형식 오류) CoverLetterCheckError다.
  BE는 이때 통과시키지 않고 다시 시도하도록 안내한다.
- 재시도하지 않는다. BE가 결과를 기다리는 시간 안에 응답해야 하기 때문이다.
- 요청과 응답에는 자기소개서가 포함되므로 본문을 로그에 남기지 않는다.
"""

import http.client
import json
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any

from app.common.versions import REGISTRY, VersionKind

JEV_URL = "https://api.typesafe.ai/v1/systemone"
# AI 명세 6.4와 같은 모델 버전을 쓴다
JEV_MODEL = "jev-1.14.0"
COVER_LETTER_CHECK_PROMPT_VERSION = "cover-letter-check-v1"
# AI 명세 2.1(임시 값): 응답을 기다리는 상한(초). BE 대기(8초)보다 짧아야 결과를 돌려줄 수 있다
JEV_TIMEOUT_SECONDS = 5.0
# AI 명세 2.1(임시 값): 이 값 이상이면 통과
USABLE_THRESHOLD = 0.5

USABLE_QUESTION = "usable"
_INSTRUCTIONS = (
    "지원자가 회사 `companyName`의 직무 `jobTitle`에 지원하며 쓴 자기소개서 `coverLetter`가 "
    "의미 있는 문장으로 쓰였고, 면접관이 이 글만 보고 지원 동기나 경험을 묻는 면접 질문을 "
    "여러 개 만들 만큼 구체적인 내용이 있는가? "
    "무작위 문자, 같은 말 반복, 한두 문장뿐인 글은 아니다."
)

# 요청 본문(JSON 바이트)과 제한 시간(초)을 받아 응답 본문을 반환한다. 테스트가 바꿔 끼운다
Post = Callable[[bytes, float], object]


class CoverLetterCheckError(RuntimeError):
    """Jev에서 판단을 받지 못했다."""


def check_questions() -> dict[str, dict[str, Any]]:
    """POST /v1/systemone의 questions 본문이다."""
    return {USABLE_QUESTION: {"type": "noul", "instructions": _INSTRUCTIONS}}


def usable_from(answers: object) -> bool:
    """POST /v1/systemone 응답의 answers로 통과 여부를 정한다."""
    if not isinstance(answers, Mapping):
        raise CoverLetterCheckError("answers가 객체가 아니다")
    answer = answers.get(USABLE_QUESTION)
    value = answer.get("noul") if isinstance(answer, Mapping) else None
    if not isinstance(value, int | float) or isinstance(value, bool):
        raise CoverLetterCheckError(f"{USABLE_QUESTION}의 noul이 숫자가 아니다")
    return value >= USABLE_THRESHOLD


class CoverLetterChecker:
    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: float = JEV_TIMEOUT_SECONDS,
        post: Post | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = REGISTRY.require(VersionKind.MODEL, JEV_MODEL)
        REGISTRY.require(VersionKind.PROMPT, COVER_LETTER_CHECK_PROMPT_VERSION)
        self._timeout_seconds = timeout_seconds
        self._post = post or self._send

    def check(self, company_name: str, job_title: str, cover_letter: str) -> bool:
        """질문을 만들 수 있는 자기소개서면 True다. 판단하지 못하면 CoverLetterCheckError다."""
        body = {
            "model": self._model,
            "state": {
                "companyName": company_name,
                "jobTitle": job_title,
                "coverLetter": cover_letter,
            },
            "questions": check_questions(),
        }
        response = self._post(json.dumps(body).encode(), self._timeout_seconds)
        if not isinstance(response, Mapping):
            raise CoverLetterCheckError("응답이 객체가 아니다")
        return usable_from(response.get("answers"))

    def _send(self, data: bytes, timeout_seconds: float) -> object:
        request = urllib.request.Request(
            JEV_URL,
            data=data,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as e:
            raise CoverLetterCheckError(f"status={e.code}") from e
        except (OSError, http.client.HTTPException, ValueError) as e:
            # 시간 초과(TimeoutError)·연결 실패(URLError)도 OSError다
            raise CoverLetterCheckError(type(e).__name__) from e
