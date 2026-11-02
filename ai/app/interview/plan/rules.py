"""질문 생성 작업의 규칙 값.

문장 순번과 질문 수 규칙은 AI 명세 2장을 따르고,
주장 수처럼 AI 내부에서만 쓰는 값도 이 파일에만 둔다.
"""

import re
from collections.abc import Mapping

from app.common.session import Persona

# AI 명세 2장: 자소서 문장 순번(sentenceNo).
# 비어 있지 않은 줄마다 나누고,
# 줄 안에서는 한글·영문·닫는 괄호·%·따옴표 뒤의 마침표·물음표·느낌표 다음 공백에서 나눈다.
# 마침표·물음표·느낌표 뒤에 닫는 따옴표·괄호가 이어져도 같다.
# 숫자 뒤 마침표는 「1. 지원 동기」 같은 번호이므로 나누지 않는다.
# 문항 질문도 같은 규칙으로 나눠 답변 앞에 포함하고 순번은 1부터 시작한다.
# 다른 파트가 같은 규칙으로 문장을 찾을 수 있도록 판단이 필요 없는 형식 규칙만 사용한다.
SENTENCE_BREAK = re.compile(
    r"(?:(?<=[가-힣A-Za-z)%\"'”’][.?!])|(?<=[가-힣A-Za-z][.?!][\"'”’)]))\s+"
)

# 주장 추출에서 사용하는 주장 수.
# 질문 5개를 생성할 때 선택할 후보가 충분하고
# 프롬프트가 지나치게 길어지지 않는 범위로 정한 AI 내부 값이다.
# 상한을 넘으면 실패로 처리하지 않고 앞의 MAX_CLAIMS개만 사용한다(claims.parse_claims)
MIN_CLAIMS = 1
MAX_CLAIMS = 10

# AI 명세 2장: 주장 수가 5개와 다르면 질문 수(app.common.session.QUESTION_COUNT)를 우선한다.
# 면접관 기준이 드러난 주장이 적으면 같은 주장을 다른 기준으로 나누어 다시 질문하고,
# 주장이 많으면 검증 가치가 큰 주장을 선택하게 한다(questions.question_system).

# AI 명세 2장 회사 카드 사용: 질문 5개 중 회사 정보와 연결하는 질문 수.
# 나머지 질문은 자소서 주장 검증에 집중하도록 상한을 둔다.
# 개발자 면접관은 경험과 회사 사업 방향·시장이 이어지지 않는 경우가 많아
# 연결을 강제하면 관계없는 질문에 항목 번호만 작성하므로 하한을 0으로 둔다(plan-v4 GMS 실측).
# 오리 면접관도 같은 이유로 연결을 강제하지 않는다
COMPANY_LINKED_MIN: Mapping[Persona, int] = {
    Persona.DEVIL: 1,
    Persona.COFFEE_CHAT: 0,
    Persona.DUCK: 0,
}
COMPANY_LINKED_MAX = 2

# AI 명세 2장: claimId가 없는 주장을 가리키면 그 질문만 1회 다시 생성한다
CLAIM_ID_REGENERATIONS = 1

# AI 명세 2장: STEP 01(주장 추출)이 끝나면 plan.progress(50)를 전송한다
PROGRESS_AFTER_CLAIMS = 50
