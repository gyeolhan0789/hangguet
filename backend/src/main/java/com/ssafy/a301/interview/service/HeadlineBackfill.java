package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.AiJobRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 임시: headline(V11)이 생기기 전에 끝난 면접의 한 줄 총평을 채운다. 기동할 때 headline이 없고 summary가 있는 결과 완료 면접마다
 * WRITE_HEADLINE 작업을 한 번 보내고, AI가 summary를 30자로 줄여 headline.written으로 돌려준다(AI 명세 4.1). 이미 보낸 면접은 다시
 * 보내지 않는다. 운영·개발 서버에서 모두 채운 뒤 다음 작업에서 이 클래스와 WRITE_HEADLINE을 지운다.
 */
@Component
public class HeadlineBackfill {
    private static final Logger LOG = LoggerFactory.getLogger(HeadlineBackfill.class);

    private final InterviewSessionRepository sessions;
    private final AiJobRepository jobs;
    private final AiJobService aiJobs;
    private final TransactionTemplate transactions;

    public HeadlineBackfill(
            InterviewSessionRepository sessions,
            AiJobRepository jobs,
            AiJobService aiJobs,
            TransactionTemplate transactions) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.aiJobs = aiJobs;
        this.transactions = transactions;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        try {
            int sent = run();
            if (sent > 0) {
                LOG.info("한 줄 총평이 없는 면접 {}건에 WRITE_HEADLINE 작업을 보냈다", sent);
            }
        } catch (RuntimeException ex) {
            LOG.warn("한 줄 총평 채우기 작업을 보내지 못했다", ex);
        }
    }

    int run() {
        Integer sent =
                transactions.execute(
                        status -> {
                            List<Long> ids =
                                    sessions
                                            .findIdsWithoutHeadline(SessionStatus.COMPLETED)
                                            .stream()
                                            .filter(
                                                    id ->
                                                            !jobs.existsByJobTypeAndSessionId(
                                                                    AiJobType.WRITE_HEADLINE, id))
                                            .toList();
                            ids.forEach(id -> aiJobs.enqueue(AiJob.writeHeadline(id)));
                            return ids.size();
                        });
        return sent == null ? 0 : sent;
    }
}
