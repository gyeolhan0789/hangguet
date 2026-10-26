"""답변을 자동 제출할지, timedOut으로 처리할지, [답변 완료]를 받을지 판단한다.

기준: AI 명세 6.2 답변 끝·채팅, 6.3 면접방 메시지(answerState·answerSubmit), 6.5 실패 처리,
API 명세 면접방 메시지의 화상 답변 끝 판단.
- 7초는 마지막 발화가 인식된 때부터 계산하고, 그 안에 다시 발화하면 처음부터 계산한다.
- 발화를 시작하지 않았으면 자동으로 제출하지 않고,
  발화를 시작하지 않은 채 60초가 지나면 timedOut이다.
- timedOut은 한 번만 알리고 같은 질문에서 계속 듣는다.
  그 뒤 발화하면 7초 규칙으로 제출한다(AI 명세 6.2).
- [답변 완료]는 발화가 없으면 EMPTY_ANSWER(2001), 답변 중이 아니면 NOT_ANSWERING(2002)으로 거절하고,
  이미 제출 중이면 받지 않는다(accepted false).
- STT 오류 뒤에도 발화가 있었으면 [답변 완료]를 받아 그때까지 인식된 글로 제출한다.
  STT 오류는 지원자가 일으킨 것이 아니므로 이미 인식된 글을 폐기하지 않는다.
- STT 오류 뒤 발화가 없으면 제출할 글이 없어 [답변 완료]로 끝낼 수 없으므로,
  오류 상태에서도 60초를 계속 계산해 timedOut으로 끝낸다.
- 답변 결과를 BE에 전달하지 못하면(submitFailed) 그 답변을 다시 제출할 때까지 기다리고,
  [답변 완료]를 수신하면 같은 답변을 다시 제출한다(AI 명세 6.5).
- 채팅은 화면이 답변 제출 API(5.7) 성공 뒤 [답변 완료]를 보내므로 발화 검사 없이 받고,
  음성을 듣지 않으므로 7초·60초를 계산하지 않는다.
시각은 호출 측이 전달하고 타이머는 호출 측이 next_deadline으로 설정한다.
- 발화(Speech)는 비공백 토큰의 끝 시각 최댓값이 증가한 응답을 수신한 시각이다.
  최댓값은 한 STT 연결 안에서 계산한다(Transcript.speech_end_ms).
- STT 자동 재연결(Reconnecting·Reconnected) 동안 7초는 중지하고,
  재연결 뒤 발화를 시작했으면 새로 계산한다.
  60초는 계속 계산한다.
- 발화 중단 안내 음성을 재생하는 동안 7초는 중지하고,
  재생이 끝난 시점부터 다시 계산한다(AI 명세 6.2 4번).
  안내 음성의 합성을 기다리는 동안에는 중지하지 않는다.
"""

from dataclasses import dataclass, replace
from enum import StrEnum

from app.common.session import InterviewMode

# 임시 값(AI 명세 6.2): 마지막 발화 뒤 자동 제출까지
AUTO_SUBMIT_SILENCE_MS = 7_000

# 임시 값(AI 명세 6.2): 발화를 시작하지 않은 채 timedOut으로 처리하기까지
NO_SPEECH_TIMEOUT_MS = 60_000


class Phase(StrEnum):
    """답변 진행 단계."""

    IDLE = "idle"  # 답변 전(질문 음성 재생 중 포함)
    LISTENING = "listening"  # 답변 중(화상은 음성 인식 연결 중 포함)
    RECONNECTING = "reconnecting"  # STT 자동 재연결 중
    ERROR = "error"  # STT 오류, 발화가 있었으면 [답변 완료]로 제출할 수 있다
    SUBMITTING = "submitting"  # 제출 중(수동·자동)
    SUBMIT_FAILED = "submit_failed"  # 제출 실패, [답변 완료]로 같은 답변을 다시 제출한다


class Decision(StrEnum):
    """호출 측이 할 일."""

    SUBMIT = "submit"  # 7초 자동 제출(answerState autoSubmitted)
    TIMEOUT = "timeout"  # 60초 timedOut(answerState timedOut)
    WAIT = "wait"  # 할 일 없음
    ACCEPT = "accept"  # [답변 완료]를 받아 제출(answerSubmit 응답 accepted true)
    ALREADY_SUBMITTING = "already_submitting"  # 이미 제출 중(accepted false)
    EMPTY_ANSWER = "empty_answer"  # 발화가 없어 거절(RPC 오류 2001)
    NOT_ANSWERING = "not_answering"  # 답변 중이 아니어서 거절(RPC 오류 2002)


@dataclass(frozen=True)
class AnswerEndState:
    phase: Phase = Phase.IDLE
    mode: InterviewMode = InterviewMode.VIDEO
    # 이 답변에서 발화를 시작했는지
    spoke: bool = False
    # 60초를 계산하기 시작한 시각(답변 시작)
    listen_started_at: int | None = None
    # 7초를 계산하기 시작한 시각: 마지막 발화 또는 발화 시작 후 재연결.
    # 계산하지 않으면 None
    silence_started_at: int | None = None
    # 이 답변에서 timedOut을 이미 알렸는지.
    # 알린 뒤에는 60초를 다시 계산하지 않는다
    timed_out: bool = False
    # 발화 중단 안내 음성을 재생 중인지
    notice_playing: bool = False


@dataclass(frozen=True)
class AnswerStarted:
    at: int
    mode: InterviewMode


@dataclass(frozen=True)
class Speech:
    at: int


@dataclass(frozen=True)
class Reconnecting:
    pass


@dataclass(frozen=True)
class Reconnected:
    at: int


@dataclass(frozen=True)
class SttError:
    pass


@dataclass(frozen=True)
class SubmitRequested:
    pass


@dataclass(frozen=True)
class SubmitFailed:
    pass


@dataclass(frozen=True)
class NoticeStarted:
    pass


@dataclass(frozen=True)
class NoticeEnded:
    at: int


@dataclass(frozen=True)
class Tick:
    now: int


AnswerEndEvent = (
    AnswerStarted
    | Speech
    | Reconnecting
    | Reconnected
    | SttError
    | SubmitRequested
    | SubmitFailed
    | NoticeStarted
    | NoticeEnded
    | Tick
)


@dataclass(frozen=True)
class AnswerEndStep:
    state: AnswerEndState
    decision: Decision = Decision.WAIT


INITIAL_STATE = AnswerEndState()


def _is_video(state: AnswerEndState) -> bool:
    return state.mode is InterviewMode.VIDEO


def _is_active(phase: Phase) -> bool:
    return phase in (Phase.LISTENING, Phase.RECONNECTING)


def _counts_no_speech(state: AnswerEndState) -> bool:
    # STT 오류 상태도 발화가 없으면 60초로 끝내야 하므로 포함한다
    return (
        _is_video(state)
        and not state.spoke
        and not state.timed_out
        and state.listen_started_at is not None
        and (_is_active(state.phase) or state.phase is Phase.ERROR)
    )


def next_answer_end(state: AnswerEndState, event: AnswerEndEvent) -> AnswerEndStep:
    """이벤트 하나를 반영한 새 상태와 할 일을 반환한다.

    그 상태에서 의미 없는 이벤트는 상태를 변경하지 않는다.
    """
    match event:
        case AnswerStarted(at=at, mode=mode):
            return AnswerEndStep(
                AnswerEndState(phase=Phase.LISTENING, mode=mode, listen_started_at=at)
            )

        case Speech(at=at):
            if not _is_video(state) or not _is_active(state.phase):
                return AnswerEndStep(state)
            # 재연결 중이거나 안내 음성 재생 중이면 7초는 중지 상태로 유지하고
            # 발화 시작 상태만 기록한다
            listening = state.phase is Phase.LISTENING and not state.notice_playing
            silence = at if listening else None
            return AnswerEndStep(replace(state, spoke=True, silence_started_at=silence))

        case Reconnecting():
            if not _is_video(state) or state.phase is not Phase.LISTENING:
                return AnswerEndStep(state)
            return AnswerEndStep(replace(state, phase=Phase.RECONNECTING, silence_started_at=None))

        case Reconnected(at=at):
            if state.phase is not Phase.RECONNECTING:
                return AnswerEndStep(state)
            # 60초(listen_started_at)는 유지한다.
            # 발화를 시작하기 전이면 7초를 설정하지 않는다
            silence = at if state.spoke and not state.notice_playing else None
            return AnswerEndStep(replace(state, phase=Phase.LISTENING, silence_started_at=silence))

        case SttError():
            if not _is_video(state) or not _is_active(state.phase):
                return AnswerEndStep(state)
            return AnswerEndStep(replace(state, phase=Phase.ERROR, silence_started_at=None))

        case SubmitRequested():
            # 자동 제출과 [답변 완료]가 겹쳐도 한 번만 제출한다
            if state.phase is Phase.SUBMITTING:
                return AnswerEndStep(state, Decision.ALREADY_SUBMITTING)
            # 이미 발화를 확인하고 제출한 답변이므로 발화 검사 없이 다시 제출한다
            if state.phase is Phase.SUBMIT_FAILED:
                return AnswerEndStep(replace(state, phase=Phase.SUBMITTING), Decision.ACCEPT)
            # 답변 시작 전(질문 음성 재생 중)이다
            if state.phase is not Phase.ERROR and not _is_active(state.phase):
                return AnswerEndStep(state, Decision.NOT_ANSWERING)
            if _is_video(state) and not state.spoke:
                return AnswerEndStep(state, Decision.EMPTY_ANSWER)
            submitting = replace(state, phase=Phase.SUBMITTING, silence_started_at=None)
            return AnswerEndStep(submitting, Decision.ACCEPT)

        case NoticeStarted():
            if not _is_video(state) or not _is_active(state.phase):
                return AnswerEndStep(state)
            return AnswerEndStep(replace(state, notice_playing=True, silence_started_at=None))

        case NoticeEnded(at=at):
            if not state.notice_playing:
                return AnswerEndStep(state)
            listening = state.phase is Phase.LISTENING and state.spoke
            return AnswerEndStep(
                replace(state, notice_playing=False, silence_started_at=at if listening else None)
            )

        case SubmitFailed():
            if state.phase is not Phase.SUBMITTING:
                return AnswerEndStep(state)
            return AnswerEndStep(replace(state, phase=Phase.SUBMIT_FAILED))

        case Tick(now=now):
            if (
                state.phase is Phase.LISTENING
                and state.silence_started_at is not None
                and now - state.silence_started_at >= AUTO_SUBMIT_SILENCE_MS
            ):
                submitting = replace(state, phase=Phase.SUBMITTING, silence_started_at=None)
                return AnswerEndStep(submitting, Decision.SUBMIT)
            if (
                _counts_no_speech(state)
                and state.listen_started_at is not None
                and now - state.listen_started_at >= NO_SPEECH_TIMEOUT_MS
            ):
                return AnswerEndStep(replace(state, timed_out=True), Decision.TIMEOUT)
            return AnswerEndStep(state)


def next_deadline(state: AnswerEndState) -> int | None:
    """다음 Tick을 보내야 하는 시각(밀리초)이다.

    7초는 발화 뒤에만, 60초는 발화 전에만 계산하므로 둘 중 하나만 해당한다.
    계산할 것이 없으면 None이다.
    """
    if state.phase is Phase.LISTENING and state.silence_started_at is not None:
        return state.silence_started_at + AUTO_SUBMIT_SILENCE_MS
    if _counts_no_speech(state) and state.listen_started_at is not None:
        return state.listen_started_at + NO_SPEECH_TIMEOUT_MS
    return None
