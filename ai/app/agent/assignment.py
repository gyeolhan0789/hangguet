"""BE가 에이전트를 배정할 때 넘긴 배정 정보(job metadata)를 읽는다.

기준: AI 명세 6.1 배정 정보, BE InterviewSessionService.assignment.
에이전트는 DB를 읽지 않으므로 질문 글은 이 값으로만 받는다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass

from app.common.session import MAX_SEQ, MIN_SEQ, InterviewMode, Persona


class AssignmentError(ValueError):
    """배정 정보가 없거나 형식이 올바르지 않다. 메시지에는 질문 글을 포함하지 않는다."""


@dataclass(frozen=True)
class Assignment:
    session_id: int
    mode: InterviewMode
    persona: Persona
    current_seq: int
    # seq → 질문 글
    questions: Mapping[int, str]

    def question(self, seq: int) -> str:
        try:
            return self.questions[seq]
        except KeyError:
            raise AssignmentError(f"배정 정보에 {seq}번 질문이 없다") from None


def parse_assignment(metadata: str) -> Assignment:
    try:
        raw = json.loads(metadata)
    except json.JSONDecodeError as e:
        raise AssignmentError("배정 정보가 JSON이 아니다") from e
    if not isinstance(raw, dict):
        raise AssignmentError("배정 정보가 객체가 아니다")
    try:
        mode = InterviewMode(_text(raw.get("mode")))
        persona = Persona(_text(raw.get("persona")))
    except ValueError as e:
        raise AssignmentError("배정 정보의 mode·persona가 올바르지 않다") from e
    questions: dict[int, str] = {}
    items = raw.get("questions")
    if not isinstance(items, list):
        raise AssignmentError("배정 정보에 questions가 없다")
    for item in items:
        if not isinstance(item, dict):
            raise AssignmentError("배정 정보의 질문 형식이 올바르지 않다")
        seq = _seq(item.get("seq"))
        content = item.get("content")
        if not isinstance(content, str) or not content.strip():
            raise AssignmentError(f"배정 정보의 {seq}번 질문 글이 비어 있다")
        questions[seq] = content
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


def _positive(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise AssignmentError(f"배정 정보의 {name}가 양의 정수가 아니다")
    return value


def _seq(value: object) -> int:
    seq = _positive(value, "seq")
    if not MIN_SEQ <= seq <= MAX_SEQ:
        raise AssignmentError(f"질문 번호는 {MIN_SEQ}~{MAX_SEQ}다")
    return seq
