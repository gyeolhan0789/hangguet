"""화상 답변을 answer.completed 결과 메시지로 BE에 전달한다.

기준: AI 명세 6.2 답변 전달, 3장(말끝 흐림·억양 폭), 6.5 결과 큐 실패.
- 말끝 흐림·억양 폭은 그 답변의 음성으로 계산한다.
- 음성 지표 계산과 결과 큐 전송은 별도 스레드에서 실행한다.
  결과 큐 전송기는 동기 Redis 클라이언트이고 재시도 중 대기하므로,
  이벤트 루프에서 실행하면 그동안 면접방 메시지를 처리하지 못한다.
- 재시도 후에도 전송하지 못하면 ResultPublishError를 전파한다.
  호출 측이 submitFailed를 알리고 [답변 완료]를 수신하면 같은 답변을 다시 전달한다.
- BE가 저장할 수 없는 답변(10,000자 초과 등)은 다시 전달해도 결과가 같으므로
  전달하지 않고 False를 반환한다.
"""

import asyncio
import logging

from app.agent.interview import FinishedAnswer
from app.common.results import ResultPublisher
from app.interview.realtime.progress import ProgressMessageError, answer_completed
from app.interview.realtime.voice import pcm16_samples, voice_metrics

log = logging.getLogger(__name__)


class AnswerDelivery:
    def __init__(self, session_id: int, results: ResultPublisher, sample_rate: int) -> None:
        self._session_id = session_id
        self._results = results
        self._sample_rate = sample_rate

    async def deliver(self, finished: FinishedAnswer) -> bool:
        """답변을 전달하면 True, BE가 저장할 수 없는 답변이라 전달하지 않았으면 False다."""
        answer = finished.answer
        speech = await asyncio.to_thread(
            voice_metrics, pcm16_samples(answer.pcm), self._sample_rate, answer.tokens
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
