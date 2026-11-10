package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AiJobRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
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
 * Outbox의 AI 작업을 Redis 큐로 보낸다. 보낼 때 DB에서 작업 내용을 읽어 메시지를 만든다(AiJobMessages). 커밋 직후 바로 보내고, 그때 실패한
 * 작업은 주기적으로 다시 보낸다. 큐에 넣은 뒤 기록에 실패하면 같은 작업이 한 번 더 갈 수 있으며, 중복 결과는 BE가 결과 큐 처리에서 거른다(AI 명세 1.4).
 */
@Component
public class AiJobPublisher {
    static final int BATCH_SIZE = 100;
    private static final Logger LOG = LoggerFactory.getLogger(AiJobPublisher.class);

    private final AiJobRepository jobs;
    private final AiJobQueue queue;
    private final AiJobMessages messages;
    private final TransactionTemplate newTransaction;

    public AiJobPublisher(
            AiJobRepository jobs,
            AiJobQueue queue,
            AiJobMessages messages,
            PlatformTransactionManager transactions) {
        this.jobs = jobs;
        this.queue = queue;
        this.messages = messages;
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
        Map<String, Object> message;
        try {
            message = messages.of(job);
        } catch (IllegalStateException ex) {
            // 다시 보내도 만들 수 없는 작업이다. 다른 작업을 막지 않도록 보낸 것으로 두고 남긴다
            LOG.error("AI 작업 메시지를 만들 수 없어 보내지 않는다: {}", job.getId(), ex);
            job.markPublished(OffsetDateTime.now(KoreaTime.ZONE));
            return;
        }
        queue.push(message);
        job.markPublished(OffsetDateTime.now(KoreaTime.ZONE));
    }
}
