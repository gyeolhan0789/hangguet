package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.repository.AiJobRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 작업을 Outbox에 넣는다. 업무 트랜잭션 안에서만 부를 수 있어, 업무가 롤백되면 작업도 남지 않고 커밋되면 반드시 큐로 간다. 실제 전송은
 * AiJobPublisher가 커밋 뒤에 한다.
 */
@Service
public class AiJobService {
    private final AiJobRepository jobs;
    private final ApplicationEventPublisher events;

    public AiJobService(AiJobRepository jobs, ApplicationEventPublisher events) {
        this.jobs = jobs;
        this.events = events;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public AiJob enqueue(AiJob job) {
        AiJob saved = jobs.save(job);
        events.publishEvent(new AiJobEnqueued(saved.getId()));
        return saved;
    }
}
