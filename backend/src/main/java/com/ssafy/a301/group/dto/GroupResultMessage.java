package com.ssafy.a301.group.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.SttGap;
import java.time.OffsetDateTime;
import java.util.List;
import tools.jackson.databind.JsonNode;

/**
 * 그룹 면접 에이전트 결과 메시지(ai:results:group, AI 명세 6.7). 종류(type)마다 쓰는 필드가 달라 쓰지 않는 필드는 null이다. 모르는 필드는
 * 무시한다.
 *
 * @param type question.started · question.spoken · answer.completed · followup.decided ·
 *     assignment.rejected
 * @param groupId assignment.rejected 거절한 그룹
 * @param occurredAt assignment.rejected 거절한 시각. 다시 시작하기 전의 거절인지 가린다
 * @param reason assignment.rejected INVALID_ASSIGNMENT
 * @param seq 그 면접 안의 질문 순서 1~6
 * @param turnVersion 에이전트가 보고 보낸 면접방 정보의 버전
 * @param kind question.started 질문 종류(COMMON · PERSONAL · FOLLOWUP)
 * @param speechMs question.started 질문 음성 길이(밀리초). 음성 없이 출제하면 0
 * @param startedAt question.started 질문을 말하기 시작한 시각
 * @param content question.started 질문 글, answer.completed 답변 글, followup.decided 꼬리질문 글
 * @param criteria question.started · followup.decided 채점 기준
 * @param promptVersion question.started · followup.decided 꼬리질문의 프롬프트 버전
 * @param modelVersion question.started · followup.decided 꼬리질문의 모델 버전
 * @param endedAt question.spoken 음성 마지막 소리 · 실패 시각
 * @param speech question.spoken은 ENDED · FAILED 글, answer.completed는 말끝 흐림 · 억양 폭(AnswerSpeech)
 * @param answerStartedAt answer.completed 답변을 듣기 시작한 시각(tokens 시각의 0ms)
 * @param answerEndedAt answer.completed 답변을 끝낸 시각
 * @param tokens answer.completed 확정 토큰과 말한 시각
 * @param sttGaps answer.completed STT가 끊겨 인식하지 못한 구간
 * @param endReason answer.completed AUTO_SUBMIT · MANUAL_SUBMIT · STT_FAILED · TIME_LIMIT
 * @param needed followup.decided 꼬리질문이 필요한지
 * @param receivedAt followup.decided 판단을 시작한 시각
 * @param generationMs followup.decided GMS 호출 시간
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record GroupResultMessage(
        String type,
        Long groupId,
        OffsetDateTime occurredAt,
        String reason,
        Long sessionId,
        Integer seq,
        Integer turnVersion,
        String kind,
        Long speechMs,
        OffsetDateTime startedAt,
        String content,
        String criteria,
        String promptVersion,
        String modelVersion,
        OffsetDateTime endedAt,
        JsonNode speech,
        OffsetDateTime answerStartedAt,
        OffsetDateTime answerEndedAt,
        List<AnswerToken> tokens,
        List<SttGap> sttGaps,
        String endReason,
        Boolean needed,
        OffsetDateTime receivedAt,
        Long generationMs) {}
