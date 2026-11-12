"""주장 추출(AI 명세 2장 STEP 01): 작업 메시지의 회사·직무·자소서에서 경험·수치 주장을 추출한다.

자소서를 미리 문장 단위로 나누고 번호를 붙여 전달하므로,
GMS가 문장 번호를 계산하지 않고 근거 문장의 번호만 반환한다.
문장 번호는 문항 순서대로 문항 질문의 문장, 답변의 문장을 이어서 매긴다.
이 모듈은 응답 형식만 검사하고, 주장이 근거 문장에 실제로 있는지는 grounding.py가 검사한다.
주장마다 드러난 인재상 기준(talentCriteria)도 함께 분류해, 면접관별 주장 선택과
회사 인재상 항목의 연결 후보 선별에 사용하게 한다(AI 명세 2장).
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from company_taxonomy.talent_criteria import TALENT_CRITERIA

from app.common.cover_letter import CoverLetterItem
from app.common.gms import Chat
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.rules import (
    MAX_CLAIMS,
    MAX_TALENT_CRITERIA_PER_CLAIM,
    MIN_CLAIMS,
    SENTENCE_BREAK,
)
from app.interview.talent import criteria_lines
from app.worker.messages import Claim, ClaimType

log = logging.getLogger(__name__)

SYSTEM = (
    "너는 면접 질문을 준비하기 위해 자기소개서에서 검증할 주장을 추출한다. "
    "주어진 자기소개서에 없는 내용은 작성하지 않는다.\n"
    f"- claims: 지원자가 직접 수행한 경험이나 수치로 제시한 성과 {MIN_CLAIMS}~{MAX_CLAIMS}개\n"
    "- text: 주장을 한 문장으로 작성한다. 근거 문장에 없는 숫자를 작성하지 않는다\n"
    "- type: 숫자로 제시한 성과이면 NUMBER, 그 밖의 경험이면 EXPERIENCE\n"
    "- sentenceNo: 근거 문장 앞의 [번호]를 그대로 작성한다\n"
    "- talentCriteria: 아래 인재상 기준 중 그 주장에 드러난 기준 이름 "
    f"0~{MAX_TALENT_CRITERIA_PER_CLAIM}개. 기준 이름을 그대로 작성하고, "
    "드러난 기준이 없으면 빈 목록으로 작성한다\n"
    f"[인재상 기준]\n{criteria_lines(TALENT_CRITERIA)}"
    'JSON으로만 답한다: {"claims": [{"text": str, "type": "EXPERIENCE" | "NUMBER", '
    '"sentenceNo": int, "talentCriteria": [str]}]}'
)
_TALENT_CRITERION_NAMES = frozenset(name for name, _ in TALENT_CRITERIA)


class ClaimSource(Protocol):
    """주장을 추출할 지원서 내용이다.

    그룹 면접의 질문 생성(PlanJob)과 지원서 주장 추출(ExtractClaimsJob)이 같은 필드로 전달한다.
    """

    @property
    def company_name(self) -> str: ...

    @property
    def job_title(self) -> str: ...

    @property
    def cover_letter_items(self) -> Sequence[CoverLetterItem]: ...


@dataclass(frozen=True)
class ClaimSet:
    claims: tuple[Claim, ...]
    # GMS 응답의 모델 이름이다
    model: str


def _sentences(text: str) -> list[str]:
    sentences: list[str] = []
    for line in text.splitlines():
        sentences.extend(s.strip() for s in SENTENCE_BREAK.split(line) if s.strip())
    return sentences


def split_sentences(items: Sequence[CoverLetterItem]) -> list[str]:
    """자소서를 sentenceNo 규칙(rules.SENTENCE_BREAK)으로 나눈다.

    문항마다 질문과 답변을 같은 규칙으로 나눠 잇는다(질문은 보통 한 문장이다).
    목록의 i번째가 i+1번 문장이다.
    """
    return [s for item in items for text in (item.question, item.answer) for s in _sentences(text)]


def build_claim_messages(job: ClaimSource, sentences: Sequence[str]) -> list[dict[str, str]]:
    numbered = "\n".join(f"[{no}] {sentence}" for no, sentence in enumerate(sentences, start=1))
    user = f"회사: {job.company_name}\n직무: {job.job_title}\n\n[자기소개서 문장]\n{numbered}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def parse_claims(content: dict[str, Any], sentences: Sequence[str]) -> tuple[Claim, ...]:
    """주장 목록의 형식을 검사한다.

    형식이 틀리면 PlanOutputError를 발생시킨다.
    주장에 명세 예시 형식의 id(c1, c2, …)를 순서대로 부여한다.
    GMS가 id를 작성하면 중복 id가 발생할 수 있고,
    질문의 claimId가 가리키는 대상이 모호해지기 때문이다.
    """
    raw = content.get("claims")
    if not isinstance(raw, list) or len(raw) < MIN_CLAIMS:
        raise PlanOutputError(f"claims는 {MIN_CLAIMS}개 이상의 목록이어야 한다")
    if len(raw) > MAX_CLAIMS:
        # 상한은 프롬프트 길이를 제한하는 AI 내부 규칙이므로 넘어도 구조 오류로 처리하지 않는다.
        # 실패로 처리하면 주장이 많은 자소서로는 면접을 시작할 수 없다
        log.warning("주장 %d개 중 앞의 %d개만 사용", len(raw), MAX_CLAIMS)
        raw = raw[:MAX_CLAIMS]
    claims: list[Claim] = []
    for item in raw:
        if not isinstance(item, dict):
            raise PlanOutputError("claims 항목이 객체가 아니다")
        text = item.get("text")
        sentence_no = item.get("sentenceNo")
        if not isinstance(text, str) or not text.strip():
            raise PlanOutputError("claims.text가 없다")
        try:
            claim_type = ClaimType(str(item.get("type")))
        except ValueError as e:
            raise PlanOutputError("claims.type을 알 수 없다") from e
        # bool은 int의 하위 형식이므로 true가 1번 문장으로 해석되지 않도록 형식을 정확히 비교한다
        if type(sentence_no) is not int or not 1 <= sentence_no <= len(sentences):
            raise PlanOutputError("claims.sentenceNo가 자소서 문장 범위 밖이다")
        claims.append(
            Claim(
                f"c{len(claims) + 1}",
                text.strip(),
                claim_type,
                sentence_no,
                _talent_criteria(item.get("talentCriteria")),
            )
        )
    return tuple(claims)


def _talent_criteria(value: object) -> tuple[str, ...]:
    """주장의 인재상 기준 이름을 검사한다(AI 명세 2장 talentCriteria).

    목록이 아니거나, 기준 12개에 없는 이름이나 중복이 있거나, 개수가 상한을 넘으면
    판정 값이 틀린 출력이므로 PlanOutputError를 발생시킨다(AI 명세 5장 출력 구조 깨짐).
    """
    if not isinstance(value, list) or len(value) > MAX_TALENT_CRITERIA_PER_CLAIM:
        limit = MAX_TALENT_CRITERIA_PER_CLAIM
        raise PlanOutputError(f"claims.talentCriteria는 기준 이름 0~{limit}개의 목록이어야 한다")
    if not all(name in _TALENT_CRITERION_NAMES for name in value):
        raise PlanOutputError("claims.talentCriteria에 인재상 기준이 아닌 이름이 있다")
    if len(set(value)) != len(value):
        raise PlanOutputError("claims.talentCriteria에 같은 기준 이름이 중복되어 있다")
    return tuple(value)


def request_claims(chat: Chat, job: ClaimSource) -> ClaimSet:
    """GMS를 한 번 호출해 주장을 추출한다.

    출력 구조가 틀렸을 때의 재시도는 호출 측이 담당한다.
    """
    sentences = split_sentences(job.cover_letter_items)
    result = chat(build_claim_messages(job, sentences))
    return ClaimSet(parse_claims(result.content, sentences), result.model)
