"""추출한 주장이 근거 문장에 실제로 있는지 검사한다.

GMS가 근거 문장에 없는 수치를 생성하면 면접 질문이 지원자가 작성하지 않은 성과를 전제로 하므로,
주장의 수량 표현마다 같은 값이 근거 문장에 있을 때만 주장을 유지한다.
- 숫자는 company-pipeline/pipeline/verify.py의 인용 검증과 같은 방식으로 비교한다.
  6.0과 6, 1,100과 1100은 같은 값이다.
- 「절반」「두 배」「3분의 1」처럼 숫자 없이 수량을 표현한 문장도 있으므로
  수량 표현을 그 값으로 변환해 비교한다.
  숫자만 인식하면 이런 문장의 수량이 빈 집합이 돼,
  수치 주장(NUMBER)이거나 GMS가 「50%」처럼 숫자로 변환해 작성한 주장이 근거가 있어도 폐기된다.
- 수량 표현 하나는 같은 값의 후보 묶음(「절반」은 50과 0.5)으로 변환하고,
  후보 중 하나가 근거 문장에 있으면 인정한다.
  원문이 「50%」이고 주장이 「절반」인 반대 방향도 같은 수량이기 때문이다.
- 단위는 비교하지 않는다.
  같은 값이 다른 단위로 쓰인 주장(「절반」과 「50명」)도 통과하지만,
  문장마다 단위 표기가 달라(%·퍼센트) 단위까지 비교하면 근거 있는 주장을 폐기하게 된다.
- 「두 배」「2배」는 2와 200을 후보로 둔다.
  「두 배」「2배」「200%」를 같은 수량으로 작성한 주장이
  어느 방향이든 근거로 인정돼야 하기 때문이다.
- 고유어 수(「세 명」「두 달」「열두 배」)는 단위를 나타내는 말 앞에 올 때만 수량으로 인식한다.
  수 관형사는 단위를 나타내는 말 앞에서 수량을 나타내기 때문이다(표준국어대사전 「한」「두」 등).
  단위는 앞말과 띄어 쓰므로(한글 맞춤법 제43항) 띄어 쓴 경우만 인정해
  「세대」「열대」처럼 단위로 끝나는 낱말을 수량으로 보지 않는다.
  GMS가 「3명」처럼 숫자로 변환해 작성해도, 원문의 「3명」을 「세 명」으로 작성해도 같은 수량이다.
- 「한」은 수량(하나) 외에 「어떤」「같은」「대략」의 뜻이 있다(표준국어대사전 「한1」).
  - 「한 마을」「한 교실」처럼 장소·무리를 나타내는 말 앞이나
    붙여 쓴 「한번」(「지난 어느 때나 기회」, 별도 낱말)은 수량으로 보지 않는다.
  - 주장 쪽의 「한」(하나)은 근거 문장에 없어도 주장을 폐기하지 않는다.
    「한 팀이 되어」처럼 뜻을 구별할 수 없는 경우가 남고,
    1은 지원자 성과를 부풀리는 수치가 아니기 때문이다.
    근거 문장 쪽의 「한 명」은 주장의 「1명」과 같은 수량으로 인정한다.
- 한계: 단위를 나타내는 말 없이 쓴 고유어 수사(「셋이서」「둘 다」)는 수량으로 인식하지 않는다.
"""

import logging
import re
from collections.abc import Sequence
from dataclasses import replace

from app.interview.plan.llm import PlanOutputError
from app.worker.messages import Claim, ClaimType

log = logging.getLogger(__name__)

# company-pipeline/pipeline/verify.py의 _numbers와 같은 숫자 규칙이다.
# AI 배포 이미지에는 ai/app만 포함되므로 company-pipeline을 가져오지 않고 같은 규칙을 둔다
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")

# 「절반」, 띄어 쓴 「반으로」.
# 「기반으로」「반영」처럼 「반」이 단어 일부인 경우는 제외한다
_HALF = re.compile(r"절반|(?<![가-힣])반(?=으로)")
HALF_VALUES = frozenset({50.0, 0.5})

# 단위를 나타내는 말 뒤에는 조사·접미사와 서술격 어미(였습니다·입니다)만 허용해
# 「두 배우」「세 배포」「두 명절」처럼 단위가 단어 일부인 경우를 제외한다
_UNIT_END = (
    r"(?=$|[^가-힣]|은|는|이|가|을|를|과|와|의|에|도|만|으로|로|씩|까지|부터|마다|째|간|동안"
    r"|쯤|가량|여|정도|보다|나|였|입|인|임)"
)
_TIMES_AFTER_NUMBER = re.compile(r"\s*배" + _UNIT_END)

# 고유어 수 관형사(표준국어대사전 「두」「석」「넉」「스무」 등)
_NATIVE_ONES = {
    "두": 2,
    "세": 3,
    "석": 3,
    "네": 4,
    "넉": 4,
    "다섯": 5,
    "여섯": 6,
    "일곱": 7,
    "여덟": 8,
    "아홉": 9,
}
_NATIVE_TENS = {
    "열": 10,
    "스물": 20,
    "서른": 30,
    "마흔": 40,
    "쉰": 50,
    "예순": 60,
    "일흔": 70,
    "여든": 80,
    "아흔": 90,
}
_NATIVE_NUMBERS = {
    "한": 1,
    "스무": 20,
    **_NATIVE_ONES,
    **_NATIVE_TENS,
    # 「열한」「스물두」처럼 십 단위와 일 단위를 붙여 쓴 수
    **{
        t + o: tv + ov
        for t, tv in _NATIVE_TENS.items()
        for o, ov in {"한": 1, **_NATIVE_ONES}.items()
    },
}
# 수량을 세는 단위를 나타내는 말. 「배」는 2와 200처럼 배수·백분율 두 값을 후보로 둔다
_UNITS = (
    "개월",
    "가지",
    "군데",
    "차례",
    "시간",
    "학기",
    "단계",
    "과목",
    "종류",
    "사람",
    "마리",
    "명",
    "개",
    "곳",
    "번",
    "달",
    "해",
    "주",
    "살",
    "대",
    "건",
    "권",
    "장",
    "줄",
    "쪽",
    "편",
    "팀",
    "조",
    "반",
    "분",
    "배",
)
# 「한」이 하나를 나타내는 단위. 장소·무리·방향을 나타내는 말(곳·팀·쪽 등) 앞의 「한」은
# 「어떤」「같은」의 뜻일 수 있어 제외한다(표준국어대사전 「한1」 「2」·「3」)
_ONE_UNITS = frozenset(
    {
        "명",
        "개",
        "가지",
        "군데",
        "번",
        "차례",
        "달",
        "해",
        "시간",
        "살",
        "대",
        "건",
        "권",
        "장",
        "마리",
        "개월",
        "주",
        "학기",
        "단계",
        "과목",
        "종류",
    }
)
# 단위를 나타내는 말은 앞말과 띄어 쓴다(한글 맞춤법 제43항).
# 띄어 쓴 경우만 인정해 「세대」「열대」「한해」처럼 단위로 끝나는 낱말을 수량으로 보지 않는다.
# 다만 흔히 붙여 쓰고 같은 모양의 다른 낱말이 드문 단위는 붙여 써도 인정한다(「두배」「세명」)
_UNSPACED_UNITS = frozenset({"배", "명", "개", "번", "가지", "달"})
_NATIVE_QUANTITY = re.compile(
    rf"(?<![가-힣])({'|'.join(sorted(_NATIVE_NUMBERS, key=len, reverse=True))})(\s*)"
    rf"({'|'.join(sorted(_UNITS, key=len, reverse=True))})" + _UNIT_END
)

# 「3분의 1」.
# 분모·분자를 숫자로 따로 비교하지 않고 같은 비율의 백분율(33·33.3)로 비교한다
_FRACTION = re.compile(r"(\d+)\s*분의\s*(\d+)")

type Expression = frozenset[float]


def _native_quantity(word: str, space: str, unit: str) -> tuple[Expression, bool] | None:
    """고유어 수 하나를 (후보 묶음, 근거 문장에 반드시 있어야 하는지)로 변환한다."""
    if not space and unit not in _UNSPACED_UNITS:
        return None
    if word == "한" and (unit not in _ONE_UNITS or (unit == "번" and not space)):
        return None
    value = float(_NATIVE_NUMBERS[word])
    values = frozenset({value, value * 100}) if unit == "배" else frozenset({value})
    # 「한」은 다른 뜻과 구별할 수 없는 경우가 남으므로 주장 쪽에서는 근거를 요구하지 않는다
    return values, word != "한"


def _number(text: str) -> float:
    return float(text.replace(",", ""))


def _quantity_expressions(text: str) -> list[tuple[Expression, bool]]:
    """글에 나타난 수량 표현마다 (같은 값으로 인정하는 후보 묶음, 근거가 필요한지)를 반환한다."""
    found: list[tuple[Expression, bool]] = []
    fraction_spans: list[tuple[int, int]] = []
    for match in _FRACTION.finditer(text):
        denominator, numerator = int(match.group(1)), int(match.group(2))
        if denominator:
            percent = numerator / denominator * 100
            found.append((frozenset({float(round(percent)), round(percent, 1)}), True))
            fraction_spans.append(match.span())
    for match in _NUMBER.finditer(text):
        # 분수의 분모·분자는 위에서 백분율 하나로 변환했으므로 별도 수량으로 비교하지 않는다
        if any(start <= match.start() < end for start, end in fraction_spans):
            continue
        value = _number(match.group())
        if _TIMES_AFTER_NUMBER.match(text, match.end()):
            found.append((frozenset({value, value * 100}), True))
        else:
            found.append((frozenset({value}), True))
    found.extend((HALF_VALUES, True) for _ in _HALF.finditer(text))
    for match in _NATIVE_QUANTITY.finditer(text):
        native = _native_quantity(match.group(1), match.group(2), match.group(3))
        if native is not None:
            found.append(native)
    return found


def expressions(text: str) -> list[Expression]:
    """글에 나타난 수량 표현마다 같은 값으로 인정하는 후보 묶음을 반환한다."""
    return [values for values, _ in _quantity_expressions(text)]


def quantities(text: str) -> set[float]:
    """근거 문장 쪽에서 비교할 값 집합이다.

    분수의 분모·분자도 숫자로 포함한다.
    """
    values = {_number(n) for n in _NUMBER.findall(text)}
    for expression in expressions(text):
        values |= expression
    return values


def is_supported(claim: Claim, sentence: str) -> bool:
    found = _quantity_expressions(claim.text)
    # 수치 주장에 수량이 없거나 근거 문장에 없는 수량이 있으면 GMS가 생성한 내용으로 판단한다
    if claim.type is ClaimType.NUMBER and not found:
        return False
    available = quantities(sentence)
    return all(values & available for values, required in found if required)


def ground_claims(claims: Sequence[Claim], sentences: Sequence[str]) -> tuple[Claim, ...]:
    """근거 문장과 맞지 않는 주장을 폐기하고, 남은 주장의 id를 c1부터 다시 부여한다.

    id를 다시 부여해 질문 생성에 전달하는 id에 빈 번호가 없게 한다.
    남은 주장이 없으면 출력 구조 깨짐과 같이 PlanOutputError를 발생시켜
    주장 추출을 다시 요청하게 한다.
    """
    kept: list[Claim] = []
    for claim in claims:
        if not is_supported(claim, sentences[claim.sentence_no - 1]):
            # 자소서 내용은 개인 정보이므로 로그에는 문장 번호만 남긴다
            log.warning("근거 문장과 맞지 않는 주장 폐기 sentenceNo=%d", claim.sentence_no)
            continue
        kept.append(replace(claim, id=f"c{len(kept) + 1}"))
    if not kept:
        raise PlanOutputError("근거 문장과 맞는 주장이 없다")
    return tuple(kept)
