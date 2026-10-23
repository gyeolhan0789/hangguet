"""주장 추출(AI 명세 2장 STEP 01): 작업 메시지의 회사·직무·자소서에서 경험·수치 주장을 추출한다.

자소서를 미리 문장 단위로 나누고 번호를 붙여 전달하므로,
GMS가 문장 번호를 계산하지 않고 근거 문장의 번호만 반환한다.
이 모듈은 응답 형식만 검사한다.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.common.gms import Chat
from app.interview.plan.llm import PlanOutputError
from app.interview.plan.rules import MAX_CLAIMS, MIN_CLAIMS, SENTENCE_BREAK
from app.worker.messages import Claim, ClaimType, PlanJob

log = logging.getLogger(__name__)

SYSTEM = (
    "너는 면접 질문을 준비하기 위해 자기소개서에서 검증할 주장을 추출한다. "
    "주어진 자기소개서에 없는 내용은 작성하지 않는다.\n"
    f"- claims: 지원자가 직접 수행한 경험이나 수치로 제시한 성과 {MIN_CLAIMS}~{MAX_CLAIMS}개\n"
    "- text: 주장을 한 문장으로 작성한다. 근거 문장에 없는 숫자를 작성하지 않는다\n"
    "- type: 숫자로 제시한 성과이면 NUMBER, 그 밖의 경험이면 EXPERIENCE\n"
    "- sentenceNo: 근거 문장 앞의 [번호]를 그대로 작성한다\n"
    'JSON으로만 답한다: {"claims": [{"text": str, "type": "EXPERIENCE" | "NUMBER", '
    '"sentenceNo": int}]}'
)


@dataclass(frozen=True)
class ClaimSet:
    claims: tuple[Claim, ...]
    # GMS 응답의 모델 이름이다
    model: str


def split_sentences(cover_letter: str) -> list[str]:
    """자소서를 sentenceNo 규칙(rules.SENTENCE_BREAK)으로 나눈다.

    목록의 i번째가 i+1번 문장이다.
    """
    sentences: list[str] = []
    for line in cover_letter.splitlines():
        sentences.extend(s.strip() for s in SENTENCE_BREAK.split(line) if s.strip())
    return sentences


def build_claim_messages(job: PlanJob, sentences: Sequence[str]) -> list[dict[str, str]]:
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
        claims.append(Claim(f"c{len(claims) + 1}", text.strip(), claim_type, sentence_no))
    return tuple(claims)


def request_claims(chat: Chat, job: PlanJob) -> ClaimSet:
    """GMS를 한 번 호출해 주장을 추출한다.

    출력 구조가 틀렸을 때의 재시도는 호출 측이 담당한다.
    """
    sentences = split_sentences(job.cover_letter)
    result = chat(build_claim_messages(job, sentences))
    return ClaimSet(parse_claims(result.content, sentences), result.model)
