"""화상 답변을 answer.completed 결과 메시지로 BE에 전달한다.

기준: AI 명세 6.2 답변 전달, 3장(말끝 흐림·억양 폭), 6.5 결과 큐 실패.
- 말끝 흐림·억양 폭은 그 답변의 음성으로 계산한다.
  다시보기 타임라인용으로 흐린 문장의 끝 시각과 답변 중 인상 판단도 함께 담는다(AI 명세 3장·6.6).
- 음성 지표 계산과 결과 큐 전송은 별도 스레드에서 실행한다.
  결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로,
  이벤트 루프에서 실행하면 그동안 면접방 메시지를 처리하지 못한다.
- 재시도 후에도 전송하지 못하면 ResultPublishError를 전파한다.
  호출 측이 submitFailed를 알리고 [답변 완료]를 수신하면 같은 답변을 다시 전달한다.
- BE가 저장할 수 없는 답변(10,000자 초과 등)은 다시 전달해도 결과가 같으므로
  전달하지 않고 False를 반환한다. 글은 음성 지표를 계산하기 전에 확인한다.
  저장하지 못할 답변의 음성 지표를 계산하지 않기 위함이다.
"""

import asyncio
import logging

from app.agent.interview import FinishedAnswer
from app.common.answer import SpeechToken, VoiceMetrics
from app.common.results import ResultPublisher
from app.interview.realtime.impression import impressions_json
from app.interview.realtime.progress import (
    ProgressMessageError,
    answer_completed,
    check_answer_content,
)
from app.interview.realtime.voice import pcm16_samples, trailing_off_at_ms, voice_metrics

log = logging.getLogger(__name__)


class AnswerDelivery:
    def __init__(
        self,
        session_id: int,
        results: ResultPublisher,
        sample_rate: int,
        *,
        impression_model: str | None = None,
    ) -> None:
        """impression_model은 인상 판단에 쓴 Jev 모델이고, 판단하지 않으면 None이다."""
        self._session_id = session_id
        self._results = results
        self._sample_rate = sample_rate
        self._impression_model = impression_model

    async def deliver(self, finished: FinishedAnswer) -> bool:
        """답변을 전달하면 True, BE가 저장할 수 없는 답변이라 전달하지 않았으면 False다."""
        answer = finished.answer
        try:
            check_answer_content(answer.content)
        except ProgressMessageError as e:
            log.error(
                "답변 글을 저장할 수 없어 전달하지 않는다: %s", e, extra={"seq": finished.seq}
            )
            return False
        speech, trailing = await asyncio.to_thread(
            _voice, answer.pcm, self._sample_rate, answer.tokens
        )
        impressions = (
            None
            if self._impression_model is None
            else impressions_json(answer.impressions, answer.started_at, self._impression_model)
        )
        try:
            message = answer_completed(
                self._session_id,
                finished.seq,
                answer.started_at,
                answer.content,
                answer.tokens,
                speech,
                finished.end_reason,
                trailing_off_at_ms=trailing,
                impressions=impressions,
                stt_gaps=answer.stt_gaps,
            )
        except ProgressMessageError as e:
            log.error(
                "answer.completed를 생성하지 못해 전달하지 않는다: %s",
                e,
                extra={"seq": finished.seq},
            )
            return False
        await asyncio.to_thread(message.publish, self._results)
        return True


def _voice(
    pcm: bytes, rate: int, tokens: tuple[SpeechToken, ...] | None
) -> tuple[VoiceMetrics, tuple[int, ...] | None]:
    samples = pcm16_samples(pcm)
    return voice_metrics(samples, rate, tokens), trailing_off_at_ms(samples, rate, tokens)
