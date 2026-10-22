package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AiJobRepository;
import java.time.OffsetDateTime;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Outbox의 AI 작업을 Redis 큐로 보낸다. 커밋 직후 바로 보내고, 그때 실패한 작업은 주기적으로 다시 보낸다. 큐에 넣은 뒤 기록에 실패하면 같은 작업이 한 번 더
 * 갈 수 있으며, 작업자가 AI 명세 1.3의 버림 조건으로 걸러 낸다.
 */
@Component
public class AiJobPublisher {
    static final int BATCH_SIZE = 100;
    private static final Logger LOG = LoggerFactory.getLogger(AiJobPublisher.class);

    private final AiJobRepository jobs;
    private final AiJobQueue queue;
    private final TransactionTemplate newTransaction;

    public AiJobPublisher(
            AiJobRepository jobs, AiJobQueue queue, PlatformTransactionManager transactions) {
        this.jobs = jobs;
        this.queue = queue;
        this.newTransaction = new TransactionTemplate(transactions);
        newTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onEnqueued(AiJobEnqueued event) {
        try {
            newTransaction.executeWithoutResult(
                    status -> jobs.findUnpublishedForUpdate(event.jobId()).ifPresent(this::send));
        } catch (RuntimeException ex) {
            // 업무는 이미 커밋됐다. 재발행이 다시 보낸다
            LOG.warn("AI 작업을 큐에 넣지 못해 재발행을 기다린다: {}", event.jobId(), ex);
        }
    }

    @Scheduled(
            fixedDelayString = "${ai-job.republish-interval:5s}",
            initialDelayString = "${ai-job.republish-interval:5s}")
    public void republish() {
        try {
            newTransaction.executeWithoutResult(
                    status -> sendAll(jobs.findUnpublishedForUpdate(BATCH_SIZE)));
        } catch (RuntimeException ex) {
            LOG.warn("보내지 못한 AI 작업을 다시 보내지 못했다", ex);
        }
    }

    // 큐가 실패하면 거기서 멈춘다. 앞서 보낸 작업의 기록은 커밋한다
    private void sendAll(List<AiJob> pending) {
        for (AiJob job : pending) {
            try {
                send(job);
            } catch (RuntimeException ex) {
                LOG.warn("AI 작업을 큐에 넣지 못했다: {}", job.getId(), ex);
                return;
            }
        }
    }

    private void send(AiJob job) {
        queue.push(job);
        job.markPublished(OffsetDateTime.now());
    }
}
