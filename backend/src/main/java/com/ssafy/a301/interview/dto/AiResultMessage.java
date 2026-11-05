package com.ssafy.a301.interview.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.SttGap;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/**
 * AI 결과 메시지(AI 명세 1.4). 종류(type)마다 쓰는 필드가 달라 쓰지 않는 필드는 null이다. AI가 필드를 더해도 읽을 수 있게 모르는 필드는 무시한다.
 *
 * @param type plan.*·question.started·answer.*·evaluation.*·recording.*·assignment.rejected(AI 명세
 *     1.4)
 * @param jobId 작업에서 나온 결과만. 받은 작업의 jobId
 * @param occurredAt 결과가 생긴 시각. assignment.rejected는 이 시각으로 다시 시작하기 전의 거절인지 가린다
 * @param progress plan.progress 진행률
 * @param claims plan.completed 자소서 주장
 * @param questions plan.completed 질문 5개
 * @param seq question.started·answer.completed 질문 순서
 * @param startedAt question.started 질문을 말하기 시작한 시각
 * @param answerStartedAt answer.completed 답변을 듣기 시작한 시각(tokens 시각의 0ms)
 * @param promptVersion plan.completed 플랜, question.started 꼬리질문의 프롬프트 버전(예비 질문은 null)
 * @param modelVersion plan.completed 플랜, question.started 꼬리질문의 모델 버전(예비 질문은 null)
 * @param content question.started 실제로 출제한 질문 글, answer.completed 인식한 답변 글
 * @param criteria question.started 실제로 출제한 질문의 채점 기준
 * @param tokens answer.completed 확정 토큰과 말한 시각
 * @param speech answer.completed 말끝 흐림·억양 폭
 * @param sttGaps answer.completed STT가 끊겨 인식하지 못한 구간. 끊긴 적이 없으면 null
 * @param endReason answer.completed AUTO_SUBMIT · MANUAL_SUBMIT · STT_FAILED
 * @param answerId answer.scored 채점한 답변
 * @param evaluation answer.scored 채점 결과(AI 명세 3장)
 * @param reason plan.failed 등 실패 이유. assignment.rejected는 INVALID_ASSIGNMENT · CAPACITY_EXCEEDED
 * @param analysisStep evaluation.progress 결과 생성 단계
 * @param answers evaluation.completed 답변별 점수·피드백(AI 명세 4장)
 * @param sessionScores evaluation.completed 기준별 점수·코멘트
 * @param speechMetrics evaluation.completed 말하기 지표(화상만)
 * @param headline evaluation.completed 결과 화면 맨 위의 한 줄 총평(30자 이내)
 * @param summary evaluation.completed 그날 이 면접까지를 반영한 다음에 해볼 것
 * @param objectKey recording.merged 합친 mp4 위치
 * @param recordingStartedAt recording.merged 합친 영상의 0초에 해당하는 시각. 이어 붙여 합쳤으면 null(AI 명세 7장)
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
        String criteria,
        List<AnswerToken> tokens,
        AnswerSpeech speech,
        List<SttGap> sttGaps,
        String endReason,
        Long answerId,
        Map<String, Object> evaluation,
        String reason,
        AnalysisStep analysisStep,
        List<EvaluatedAnswer> answers,
        List<CriterionScore> sessionScores,
        SpeechMetrics speechMetrics,
        String headline,
        String summary,
        String objectKey,
        OffsetDateTime recordingStartedAt) {

    /** evaluation.completed 답변 하나. evaluation은 COVER_LETTER를 확정한 채점 결과 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record EvaluatedAnswer(
            Long answerId,
            Integer score,
            String goodPoint,
            String improvePoint,
            Map<String, Object> evaluation) {}

    /** evaluation.completed 기준 하나 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CriterionScore(Criterion criterion, Integer score, String comment) {}

    /** evaluation.completed 말하기 지표(speech_metrics). 구하지 못한 값은 null */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SpeechMetrics(
            BigDecimal fillerPerMin,
            Integer longPauseCount,
            BigDecimal speedDeviationPct,
            BigDecimal trailingOffRatio,
            BigDecimal pitchRangeSt) {}
}
