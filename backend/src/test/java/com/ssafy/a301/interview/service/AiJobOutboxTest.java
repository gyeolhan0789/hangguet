package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AiJobRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

/** 실제 PostgreSQL로 Outbox가 업무 트랜잭션과 함께 커밋·롤백되고, 보내지 못한 작업을 다시 보내는지 확인한다. 큐는 가짜다. */
@SpringBootTest
class AiJobOutboxTest {
    @Autowired private AiJobService service;
    @Autowired private AiJobPublisher publisher;
    @Autowired private AiJobRepository jobs;
    @Autowired private TransactionTemplate transactions;
    @MockitoBean private AiJobQueue queue;
    // 면접 데이터 없이 Outbox만 확인하므로 메시지는 jobId만 담는다
    @MockitoBean private AiJobMessages messages;
    private final List<UUID> created = new ArrayList<>();

    @AfterEach
    void cleanup() {
        jobs.deleteAllById(created);
    }

    @Test
    void committedJobIsSentAfterCommit() {
        UUID id = enqueue(AiJob.scoreAnswer(-55L, -903L));

        verify(queue).push(argThat(message -> id.toString().equals(message.get("jobId"))));
        AiJob saved = jobs.findById(id).orElseThrow();
        assertThat(saved.getJobType()).isEqualTo(AiJobType.SCORE_ANSWER);
        assertThat(saved.getAnswerId()).isEqualTo(-903L);
        assertThat(saved.getPublishedAt()).isNotNull();
    }

    @Test
    void rolledBackJobIsNeitherStoredNorSent() {
        UUID[] id = new UUID[1];
        transactions.executeWithoutResult(
                status -> {
                    id[0] = service.enqueue(AiJob.plan(-55L)).getId();
                    status.setRollbackOnly();
                });

        assertThat(jobs.findById(id[0])).isEmpty();
        verify(queue, never()).push(any());
    }

    @Test
    void enqueueNeedsBusinessTransaction() {
        assertThatThrownBy(() -> service.enqueue(AiJob.plan(-55L)))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    void jobFailedToSendIsSentAgainOnce() {
        doThrow(new QueryTimeoutException("Redis 연결 실패")).when(queue).push(any());
        UUID id = enqueue(AiJob.evaluate(-55L));
        assertThat(jobs.findById(id).orElseThrow().getPublishedAt()).isNull();

        reset(queue);
        publisher.republish();
        publisher.republish();

        verify(queue, times(1))
                .push(argThat(message -> id.toString().equals(message.get("jobId"))));
        assertThat(jobs.findById(id).orElseThrow().getPublishedAt()).isNotNull();
    }

    @BeforeEach
    void setUp() {
        when(messages.of(any()))
                .thenAnswer(call -> Map.of("jobId", call.<AiJob>getArgument(0).getId().toString()));
    }

    private UUID enqueue(AiJob job) {
        UUID id = transactions.execute(status -> service.enqueue(job).getId());
        created.add(id);
        return id;
    }
}
