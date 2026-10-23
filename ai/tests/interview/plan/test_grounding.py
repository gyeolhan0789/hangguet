import logging

import pytest

from app.interview.plan.claims import split_sentences
from app.interview.plan.grounding import ground_claims, is_supported, quantities
from app.interview.plan.llm import PlanOutputError
from app.worker.messages import Claim, ClaimType
from tests.interview.plan.fakes import JOB

SENTENCES = split_sentences(JOB.cover_letter)
NUMBER = ClaimType.NUMBER
EXPERIENCE = ClaimType.EXPERIENCE
# 실제 GMS 시험에서 근거가 있는데도 폐기된 자소서 문장이다
HALF_SENTENCE = "또한 Redis 캐시를 도입해 피크 시간 DB 부하를 절반으로 낮췄습니다."


def supported(text: str, claim_type: ClaimType, sentence: str) -> bool:
    return is_supported(Claim("c1", text, claim_type, 1), sentence)


def test_number_claim_with_number_in_sentence_is_kept() -> None:
    assert supported("주문 조회 응답 시간을 40% 줄였다", NUMBER, SENTENCES[3])


def test_number_not_in_sentence_is_dropped() -> None:
    assert not supported("주문 조회 응답 시간을 60% 줄였다", NUMBER, SENTENCES[3])
    # 경험 주장도 근거 문장에 없는 숫자를 포함하면 폐기한다
    assert not supported("팀원 5명과 절차를 정리했다", EXPERIENCE, SENTENCES[5])


def test_number_claim_without_quantity_is_dropped() -> None:
    assert not supported("캐시 계층을 설계했다", NUMBER, SENTENCES[4])
    assert supported("캐시 계층을 설계했다", EXPERIENCE, SENTENCES[4])


def test_numbers_match_regardless_of_format() -> None:
    """6.0과 6, 1,100과 1100은 같은 숫자로 간주한다(ai/pipeline/verify.py와 같은 규칙)."""
    sentence = "처리량을 1,100건으로 늘리고 장애를 6건 줄였습니다."

    assert supported("처리량 1100건, 장애 6.0건 감소", NUMBER, sentence)


@pytest.mark.parametrize(
    ("text", "claim_type"),
    [
        # GMS가 원문의 수량 표현을 그대로 사용하고 수치 주장으로 분류한 경우
        ("피크 시간 DB 부하를 절반으로 낮췄다", NUMBER),
        # GMS가 원문의 「절반」을 숫자로 변환해 작성한 경우
        ("피크 시간 DB 부하를 50% 낮췄다", NUMBER),
        ("피크 시간 DB 부하를 50% 낮췄다", EXPERIENCE),
        ("Redis 캐시로 DB 부하를 절반으로 낮췄다", EXPERIENCE),
    ],
)
def test_half_claim_is_supported_by_half_sentence(text: str, claim_type: ClaimType) -> None:
    assert supported(text, claim_type, HALF_SENTENCE)


def test_half_claim_is_kept_after_grounding() -> None:
    """실제 시험에서 폐기된 문장(6번)의 주장이 유지되고 id가 그대로 이어진다."""
    sentences = [*SENTENCES[:5], HALF_SENTENCE]
    claims = (
        Claim("c1", "캐시 계층을 설계했다", EXPERIENCE, 5),
        Claim("c2", "피크 시간 DB 부하를 절반으로 낮췄다", NUMBER, 6),
    )

    assert ground_claims(claims, sentences) == claims


def test_rewritten_number_not_matching_quantity_is_dropped() -> None:
    assert not supported("피크 시간 DB 부하를 70% 낮췄다", NUMBER, HALF_SENTENCE)
    assert not supported("피크 시간 DB 부하를 3배 낮췄다", NUMBER, HALF_SENTENCE)


def test_quantity_word_not_in_sentence_is_dropped() -> None:
    assert not supported("응답 시간을 절반으로 줄였다", NUMBER, SENTENCES[3])
    assert not supported("처리량을 두 배로 늘렸다", NUMBER, SENTENCES[3])


def test_claim_with_one_unsupported_quantity_is_dropped() -> None:
    """수량 표현 하나라도 근거 문장에 없으면 GMS가 생성한 수치가 섞인 주장으로 판단한다."""
    sentence = "응답 시간을 40% 줄였습니다."

    assert not supported("응답 시간을 40% 줄이고 처리량을 3배 늘렸다", NUMBER, sentence)
    assert not supported("응답 시간을 40% 줄이고 부하를 절반으로 낮췄다", EXPERIENCE, sentence)


@pytest.mark.parametrize(
    ("sentence", "claim"),
    [
        ("배포 시간을 반으로 줄였습니다.", "배포 시간을 50% 줄였다"),
        ("처리량을 두 배로 늘렸습니다.", "처리량을 2배로 늘렸다"),
        ("처리량을 세배 늘렸습니다.", "처리량을 3배 늘렸다"),
        ("처리량이 열 배가 됐습니다.", "처리량을 10배로 늘렸다"),
        # 「배」 뒤에 서술격 어미나 조사가 오는 문장
        ("처리량이 세 배였습니다.", "처리량을 3배로 늘렸다"),
        ("처리량이 기존의 두 배입니다.", "처리량을 2배로 늘렸다"),
        ("처리량을 두 배와 비슷하게 늘렸습니다.", "처리량을 2배로 늘렸다"),
        ("트래픽 두 배를 처리했습니다.", "트래픽 2배를 처리했다"),
        ("처리량이 기존의 세 배이다.", "처리량을 3배로 늘렸다"),
        ("두 배인 처리량을 확보했습니다.", "처리량을 2배로 늘렸다"),
        ("처리량이 기존 대비 두 배임을 확인했습니다.", "처리량을 2배로 늘렸다"),
        ("비용이 두 배도 넘었습니다.", "비용이 2배를 넘었다"),
        ("처리량이 예상의 세 배보다 많았습니다.", "처리량을 3배로 늘렸다"),
        ("처리량을 두 배만큼 늘렸습니다.", "처리량을 2배로 늘렸다"),
        ("처리량은 두 배는 늘었습니다.", "처리량을 2배로 늘렸다"),
        ("처리량이 두 배나 늘었습니다.", "처리량을 2배로 늘렸다"),
        ("기존의 두 배의 요청을 처리했습니다.", "처리량을 2배로 늘렸다"),
        ("한 달 만에 두 배에 도달했습니다.", "처리량을 2배로 늘렸다"),
        ("매달 두 배씩 늘었습니다.", "처리량을 2배로 늘렸다"),
        ("최대 세 배까지 늘렸습니다.", "처리량을 3배로 늘렸다"),
        ("처리량을 두 배정도 늘렸습니다.", "처리량을 2배로 늘렸다"),
        ("처리량을 두 배로 늘렸습니다.", "처리량을 200% 늘렸다"),
        # 숫자로 작성한 「2배」도 「200%」와 같은 수량이다
        ("처리량을 2배로 늘렸습니다.", "처리량을 200% 늘렸다"),
        ("처리량을 200% 늘렸습니다.", "처리량을 2배로 늘렸다"),
        ("비용을 3분의 1로 줄였습니다.", "비용을 3분의 1로 줄였다"),
        ("비용을 3분의 1로 줄였습니다.", "비용을 33%로 줄였다"),
        ("비용을 4분의 1로 줄였습니다.", "비용을 25%로 줄였다"),
        ("비용을 3분의 2로 줄였습니다.", "비용을 66.7%로 줄였다"),
        # 백분율은 반올림한 정수로도 비교한다
        ("비용을 3분의 2로 줄였습니다.", "비용을 67%로 줄였다"),
    ],
)
def test_quantity_expressions_are_compared_by_value(sentence: str, claim: str) -> None:
    assert supported(claim, NUMBER, sentence)


@pytest.mark.parametrize(
    ("sentence", "claim"),
    [
        # 원문은 숫자이고 GMS가 수량 표현으로 변환해 작성한 경우
        ("DB 부하를 50% 낮췄습니다.", "DB 부하를 절반으로 낮췄다"),
        ("비용을 33% 줄였습니다.", "비용을 3분의 1로 줄였다"),
        ("처리량을 200% 늘렸습니다.", "처리량을 두 배로 늘렸다"),
    ],
)
def test_quantity_word_claim_is_supported_by_number_sentence(sentence: str, claim: str) -> None:
    assert supported(claim, EXPERIENCE, sentence)
    assert supported(claim, NUMBER, sentence)


@pytest.mark.parametrize(
    "text",
    [
        "실행 계획을 기반으로 인덱스를 추가했다",
        "리뷰 의견을 반영했다",
        "두 배우와 협업했다",
        "세 배포 환경을 구성했다",
        "두 배정 규칙을 정리했다",
        "반드시 테스트를 작성했다",
    ],
)
def test_words_containing_quantity_syllables_are_not_quantities(text: str) -> None:
    assert quantities(text) == set()


def test_zero_denominator_fraction_adds_no_percent() -> None:
    assert quantities("0분의 1") == {0.0, 1.0}


def test_ground_claims_drops_unsupported_and_renumbers(caplog: pytest.LogCaptureFixture) -> None:
    """근거가 없는 주장만 폐기하고 남은 주장의 id는 빈 번호 없이 다시 부여한다."""
    claims = (
        Claim("c1", "응답 시간을 60% 줄였다", NUMBER, 4),
        Claim("c2", "팀원 4명과 절차를 정리했다", EXPERIENCE, 6),
    )

    with caplog.at_level(logging.WARNING):
        kept = ground_claims(claims, SENTENCES)

    assert kept == (Claim("c1", "팀원 4명과 절차를 정리했다", EXPERIENCE, 6),)
    assert "sentenceNo=4" in caplog.text
    assert "60%" not in caplog.text


def test_all_claims_dropped_is_output_error() -> None:
    claims = (Claim("c1", "응답 시간을 90% 줄였다", NUMBER, 4),)

    with pytest.raises(PlanOutputError):
        ground_claims(claims, SENTENCES)


@pytest.mark.parametrize(
    ("sentence", "claim"),
    [
        # GMS가 원문의 고유어 수를 숫자로 변환해 작성한 경우
        ("팀원 세 명과 장애 대응 절차를 정리했습니다.", "팀원 3명과 절차를 정리했다"),
        ("두 달 만에 서비스를 출시했습니다.", "2개월 만에 서비스를 출시했다"),
        ("석 달 동안 운영했습니다.", "3개월 동안 운영했다"),
        ("스물두 명이 참여했습니다.", "22명이 참여했다"),
        ("스무 명을 교육했습니다.", "20명을 교육했다"),
        ("열한 번 배포했습니다.", "11번 배포했다"),
        ("세 번째 시도에서 성공했습니다.", "3번째 시도에서 성공했다"),
        ("다섯 가지 기능을 만들었습니다.", "5가지 기능을 만들었다"),
        # 흔히 붙여 쓰는 단위는 붙여 써도 같은 수량이다
        ("세명이 참여했습니다.", "3명이 참여했다"),
        # 원문은 숫자이고 GMS가 고유어 수로 작성한 경우
        ("팀원 3명과 절차를 정리했습니다.", "팀원 세 명과 절차를 정리했다"),
        ("신입 한 명을 채용했습니다.", "신입 1명을 채용했다"),
    ],
)
def test_native_numbers_are_compared_by_value(sentence: str, claim: str) -> None:
    assert supported(claim, NUMBER, sentence)


def test_native_number_not_in_sentence_is_dropped() -> None:
    assert not supported("팀원 다섯 명과 절차를 정리했다", EXPERIENCE, "팀원 세 명과 정리했습니다.")


@pytest.mark.parametrize(
    "text",
    [
        # 단위로 끝나는 낱말(한글 맞춤법 제43항: 단위는 앞말과 띄어 쓴다)
        "세대 간 소통을 이끌었다",
        "MZ세대 고객을 분석했다",
        "열대 지역 사용자를 조사했다",
        "한해 동안 운영했다",
        # 「한」이 「어떤」「같은」의 뜻인 경우(표준국어대사전 「한1」)
        "한 마을에서 자랐다",
        "한 팀이 되어 협업했다",
        # 붙여 쓴 「한번」은 「기회」를 뜻하는 별도 낱말이다
        "한번 더 시도했다",
        "석사 과정을 마쳤다",
    ],
)
def test_words_that_are_not_native_quantities(text: str) -> None:
    assert quantities(text) == set()


def test_han_before_number_means_about() -> None:
    """「한 20분」의 「한」은 「대략」의 뜻이므로 20만 수량이다(표준국어대사전 「한1」 「4」)."""
    assert quantities("응답에 한 20분쯤 걸렸다") == {20.0}


def test_spaced_han_beon_is_one() -> None:
    assert quantities("한 번 배포했다") == {1.0}


def test_han_in_claim_does_not_require_sentence_quantity() -> None:
    """주장 쪽의 「한」(하나)은 근거 문장에 없어도 주장을 폐기하지 않는다.

    다른 뜻과 구별할 수 없는 경우가 남기 때문이다.
    """
    assert supported("한 명의 팀원으로서 배포를 담당했다", EXPERIENCE, "배포를 담당했습니다.")
    assert supported("한 가지 기능을 맡았다", NUMBER, "결제 기능을 맡았습니다.")
