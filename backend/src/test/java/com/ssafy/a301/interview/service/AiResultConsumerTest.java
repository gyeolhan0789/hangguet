package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.SQLTransientConnectionException;
import org.hibernate.exception.ConstraintViolationException;
import org.hibernate.exception.JDBCConnectionException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.orm.jpa.JpaSystemException;
import org.springframework.transaction.CannotCreateTransactionException;

/** 결과 처리 실패 중 같은 메시지를 다시 처리할 것(잠시 뒤 될 수 있는 실패)과 실패 목록으로 옮길 것을 나누는지 확인한다. */
class AiResultConsumerTest {

    @Test
    void connectionTimeoutAndLockFailuresAreTemporary() {
        assertThat(AiResultConsumer.isTemporary(new QueryTimeoutException("시간 초과"))).isTrue();
        assertThat(AiResultConsumer.isTemporary(new CannotAcquireLockException("잠금 대기"))).isTrue();
        assertThat(AiResultConsumer.isTemporary(new RedisConnectionFailureException("Redis 끊김")))
                .isTrue();
        assertThat(AiResultConsumer.isTemporary(new CannotCreateTransactionException("DB 끊김")))
                .isTrue();
        // 감싼 예외라도 원인이 연결 장애면 다시 처리한다
        assertThat(
                        AiResultConsumer.isTemporary(
                                new JpaSystemException(new JDBCConnectionException("DB 끊김", null))))
                .isTrue();
        assertThat(
                        AiResultConsumer.isTemporary(
                                new IllegalStateException(
                                        new SQLTransientConnectionException("연결 대기 초과"))))
                .isTrue();
    }

    @Test
    void logDescriptionHasIdsButNotAnswerText() {
        String message =
                "{\"type\":\"evaluation.completed\",\"sessionId\":55,\"jobId\":\"j-1\","
                        + "\"summary\":\"비밀 답변 내용\"}";
        assertThat(AiResultConsumer.describe(message))
                .isEqualTo("type=evaluation.completed sessionId=55 jobId=j-1")
                .doesNotContain("비밀");
        assertThat(AiResultConsumer.describe("비밀 {")).isEqualTo("형식 오류(길이 4)");
    }

    @Test
    void invalidMessageConstraintAndUnexpectedFailuresAreNotTemporary() {
        assertThat(AiResultConsumer.isTemporary(new InvalidAiResultException("형식 오류"))).isFalse();
        assertThat(
                        AiResultConsumer.isTemporary(
                                new DataIntegrityViolationException(
                                        "not-null 위반",
                                        new ConstraintViolationException("위반", null, null))))
                .isFalse();
        assertThat(AiResultConsumer.isTemporary(new NullPointerException())).isFalse();
        assertThat(AiResultConsumer.isTemporary(new IllegalStateException("예상 못 한 오류"))).isFalse();
    }
}
