package com.ssafy.a301.interview.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/**
 * AI 결과 메시지(AI 명세 1.4). 종류(type)마다 쓰는 필드가 달라 쓰지 않는 필드는 null이다. AI가 필드를 더해도 읽을 수 있게 모르는 필드는 무시한다.
 *
 * @param type plan.progress · plan.completed · plan.failed · question.started · answer.completed ·
 *     answer.scored 등
 * @param jobId 작업에서 나온 결과만. 받은 작업의 jobId
 * @param progress plan.progress 진행률
 * @param claims plan.completed 자소서 주장
 * @param questions plan.completed 질문 5개
 * @param seq question.started·answer.completed 질문 순서
 * @param startedAt question.started 질문을 말하기 시작한 시각
 * @param answerStartedAt answer.completed 답변을 듣기 시작한 시각(tokens 시각의 0ms)
 * @param content answer.completed 인식한 답변 글
 * @param tokens answer.completed 확정 토큰과 말한 시각
 * @param speech answer.completed 말끝 흐림·억양 폭
 * @param endReason answer.completed AUTO_SUBMIT · MANUAL_SUBMIT
 * @param answerId answer.scored 채점한 답변
 * @param evaluation answer.scored 채점 결과(AI 명세 3장)
 * @param reason plan.failed 등 실패 이유
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AiResultMessage(
        String type,
        Long sessionId,
        String jobId,
        OffsetDateTime occurredAt,
        Integer progress,
        List<PlanClaim> claims,
        List<PlanQuestion> questions,
        String promptVersion,
        String modelVersion,
        Integer seq,
        OffsetDateTime startedAt,
        OffsetDateTime answerStartedAt,
        String content,
        List<AnswerToken> tokens,
        AnswerSpeech speech,
        String endReason,
        Long answerId,
        Map<String, Object> evaluation,
        String reason) {}
