"""BE가 에이전트를 배정할 때 넘긴 배정 정보(job metadata)를 읽는다.

기준: AI 명세 6.1 배정 정보, BE InterviewSessionService.assignment.
에이전트는 DB를 읽지 않으므로 질문 글과 채점 기준은 이 값으로만 받는다.
형식이 틀린 배정 정보로 면접을 시작하면 질문 도중에 진행할 수 없게 되므로,
시작 전에 질문 5개와 채점 기준까지 전체를 검사한다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

from app.common.session import MAX_SEQ, MIN_SEQ, QUESTION_COUNT, InterviewMode, Persona

# AI 명세 6.1: 배정 정보는 512KiB 이하다(UTF-8 바이트 기준)
MAX_METADATA_BYTES = 512 * 1024


class AssignmentError(ValueError):
    """배정 정보가 없거나 형식이 올바르지 않다. 메시지에는 질문 글을 포함하지 않는다."""


@dataclass(frozen=True)
class AssignedQuestion:
    content: str
    # AI 명세 6.4: 리액션 판단의 입력이다
    criteria: str


@dataclass(frozen=True)
class Assignment:
    session_id: int
    mode: InterviewMode
    persona: Persona
    current_seq: int
    # seq → 질문
    questions: Mapping[int, AssignedQuestion]

    def question(self, seq: int) -> str:
        return self._question(seq).content

    def criteria(self, seq: int) -> str:
        return self._question(seq).criteria

    def _question(self, seq: int) -> AssignedQuestion:
        try:
            return self.questions[seq]
        except KeyError:
            raise AssignmentError(f"배정 정보에 {seq}번 질문이 없다") from None


def parse_assignment(metadata: str) -> Assignment:
    """배정 정보 JSON을 해석한다.

    모르는 필드는 작업 메시지(AI 명세 1.3)와 같게 무시한다.
    BE가 필드를 먼저 추가해도 배포 순서와 관계없이 면접을 시작하게 하기 위함이다.
    """
    if len(metadata.encode("utf-8")) > MAX_METADATA_BYTES:
        raise AssignmentError(f"배정 정보가 {MAX_METADATA_BYTES:,}바이트를 넘는다")
    try:
        raw = json.loads(metadata)
    except (json.JSONDecodeError, RecursionError) as e:
        # 지나치게 깊이 중첩된 JSON은 RecursionError가 발생하므로 형식 오류로 처리한다
        raise AssignmentError("배정 정보가 JSON이 아니다") from e
    if not isinstance(raw, dict):
        raise AssignmentError("배정 정보가 객체가 아니다")
    try:
        mode = InterviewMode(_text(raw.get("mode")))
        persona = Persona(_text(raw.get("persona")))
    except ValueError as e:
        raise AssignmentError("배정 정보의 mode·persona가 올바르지 않다") from e
    questions: dict[int, AssignedQuestion] = {}
    items = raw.get("questions")
    # 질문 5개를 배정 때 모두 받아야 다음 질문을 진행할 수 있다(AI 명세 6.1)
    if not isinstance(items, list) or len(items) != QUESTION_COUNT:
        raise AssignmentError(f"배정 정보의 questions가 질문 {QUESTION_COUNT}개가 아니다")
    for item in items:
        if not isinstance(item, dict):
            raise AssignmentError("배정 정보의 질문 형식이 올바르지 않다")
        seq = _seq(item.get("seq"))
        if seq in questions:
            raise AssignmentError(f"배정 정보의 {seq}번 질문이 중복된다")
        questions[seq] = AssignedQuestion(
            content=_required(item.get("content"), f"{seq}번 질문 글"),
            criteria=_required(item.get("criteria"), f"{seq}번 채점 기준"),
        )
    return Assignment(
        session_id=_positive(raw.get("sessionId"), "sessionId"),
        mode=mode,
        persona=persona,
        current_seq=_seq(raw.get("currentSeq")),
        questions=questions,
    )


def _text(value: object) -> str:
    # 문자열이 아니면 열거형 변환에서 ValueError로 거부되도록 빈 값을 넘긴다
    return value if isinstance(value, str) else ""


def _required(value: object, name: str) -> str:
    # 질문 생성이 질문 글·채점 기준을 strip 기준으로 거르므로(plan/questions.py),
    # 같은 기준으로 검사한다
    if not isinstance(value, str) or not value.strip():
        raise AssignmentError(f"배정 정보의 {name}이 비어 있다")
    return value


def _positive(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise AssignmentError(f"배정 정보의 {name}가 양의 정수가 아니다")
    return value


def _seq(value: object) -> int:
    seq = _positive(value, "seq")
    if not MIN_SEQ <= seq <= MAX_SEQ:
        raise AssignmentError(f"질문 번호는 {MIN_SEQ}~{MAX_SEQ}다")
    return seq
