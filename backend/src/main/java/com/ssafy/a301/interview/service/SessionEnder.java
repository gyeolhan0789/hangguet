package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.EndReason;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.RecordingRepository;
import com.ssafy.a301.interview.repository.SpeechMetricRepository;
import com.ssafy.a301.practice.service.PracticeService;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Component;

/**
 * 면접 하나를 끝낸다(5.8, BE 설계 5.4). 개인 면접의 5.8과 그룹 세션 종료(docs/그룹면접-설계.md 6.10)가 같이 쓴다. 면접 행(그룹은 그룹 → 면접
 * 행)을 잠근 트랜잭션 안에서 부른다. 면접방은 부르는 쪽이 커밋 뒤에 정리한다.
 */
@Component
public class SessionEnder {

    private final AnswerRepository answers;
    private final PracticeService practices;
    private final SessionRuntimeService runtimes;
    private final AiJobService aiJobs;
    private final RecordingRepository recordings;
    private final SpeechMetricRepository speechMetrics;

    public SessionEnder(
            AnswerRepository answers,
            PracticeService practices,
            SessionRuntimeService runtimes,
            AiJobService aiJobs,
            RecordingRepository recordings,
            SpeechMetricRepository speechMetrics) {
        this.answers = answers;
        this.practices = practices;
        this.runtimes = runtimes;
        this.aiJobs = aiJobs;
        this.recordings = recordings;
        this.speechMetrics = speechMetrics;
    }

    /**
     * 답변이 있으면 결과 생성을 시작하고 시작일(한국 시간)에 처음이면 연습 기록을 남긴다. 답변이 없으면 ABORTED다. IN_PROGRESS가 아니면 409
     * INVALID_SESSION_STATE.
     *
     * @param gazeRatio 화면이 잰 시선 비율. 결과가 나오는 화상 면접일 때만 남긴다. 화면이 보내지 않은 종료는 null
     * @param reason 그룹 세션이 끝난 이유. 개인 면접은 null
     * @param mergeRecording 화상 면접의 녹화 합치기 작업을 넣을지. 그룹 면접은 그룹이 끝날 때 따로 정한다
     */
    public SessionResponse end(
            InterviewSession session,
            OffsetDateTime now,
            BigDecimal gazeRatio,
            EndReason reason,
            boolean mergeRecording) {
        long sessionId = session.getId();
        int answeredCount = answers.countByQuestionSessionId(sessionId);
        boolean practiced = session.end(now, answeredCount, reason);
        boolean leveledUp = false;
        if (practiced) {
            leveledUp =
                    practices.recordAndCheckLevelUp(
                            session.getUser().getId(),
                            KoreaTime.dateOf(session.getStartedAt()),
                            KoreaTime.dateOf(now));
            AiJob job = aiJobs.enqueue(AiJob.evaluate(sessionId));
            runtimes.startAnalysis(sessionId, now.toInstant(), job.getId());
            if (session.isVideo()) {
                if (mergeRecording) {
                    // 녹화 트랙 합치기(AI 명세 7장). 결과 생성과 따로 돌고 5.9에서는 다시 하지 않는다.
                    // 다시보기(6.4)가 합치는 중과 실패를 구분하도록 합친 녹화 행을 MERGING으로 먼저 만든다
                    aiJobs.enqueue(AiJob.mergeRecording(sessionId));
                    recordings.save(Recording.mergingSessionVideo(session));
                }
                if (gazeRatio != null) {
                    // 말하기 지표는 결과가 나올 때 채운다(AiResultService)
                    SpeechMetric metric = new SpeechMetric(session, null, null, null, null, null);
                    metric.recordGazeRatio(gazeRatio.setScale(2, RoundingMode.HALF_UP));
                    speechMetrics.save(metric);
                }
            }
        }
        return InterviewMapper.toSessionResponse(
                session,
                runtimes.current(sessionId, now.toInstant()),
                null,
                answeredCount,
                now,
                leveledUp);
    }
}
