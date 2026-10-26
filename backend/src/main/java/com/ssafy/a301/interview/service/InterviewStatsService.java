package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 연습 면접(답변 1개 이상으로 끝난 면접, SessionStatus.PRACTICE) 집계(BE 설계 6.1). 날짜는 한국 시간 시작일이다. 3.1 홈·3.2 통계·5.13
 * 목록·7.1 성장 리뷰가 같은 계산을 쓴다.
 */
@Service
public class InterviewStatsService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final InterviewSessionRepository sessions;

    public InterviewStatsService(InterviewSessionRepository sessions) {
        this.sessions = sessions;
    }

    /** 그날(한국 시간 시작일) 연습 면접 수와 연습 시간(분) */
    public record DailyPractice(int interviewCount, int practiceMinutes) {}

    /** 전체 연습 면접 수·연습 시간(분)과 가장 최근 연습 면접의 직무(없으면 null) */
    public record Totals(int interviewCount, int practiceMinutes, String latestJobTitle) {}

    /** 시간은 면접마다 (종료 − 시작) 초를 더해 60으로 나눠 내림한다. 자정을 넘긴 면접도 시작일에 전체 시간을 넣는다 */
    @Transactional(readOnly = true)
    public DailyPractice daily(long userId, LocalDate date) {
        List<Object[]> durations =
                sessions.findPracticeDurations(
                        userId,
                        SessionStatus.PRACTICE,
                        date.atStartOfDay(KST).toOffsetDateTime(),
                        date.plusDays(1).atStartOfDay(KST).toOffsetDateTime());
        long seconds = 0;
        for (Object[] duration : durations) {
            seconds +=
                    Duration.between((OffsetDateTime) duration[0], (OffsetDateTime) duration[1])
                            .getSeconds();
        }
        return new DailyPractice(durations.size(), Math.toIntExact(seconds / 60));
    }

    @Transactional(readOnly = true)
    public Totals totals(long userId) {
        List<String> jobTitles =
                sessions.findPracticeJobTitles(userId, SessionStatus.PRACTICE, Limit.of(1));
        return new Totals(
                Math.toIntExact(sessions.countPracticeSessions(userId, SessionStatus.PRACTICE)),
                Math.toIntExact(
                        sessions.sumPracticeSeconds(userId, SessionStatus.practiceNames()) / 60),
                jobTitles.isEmpty() ? null : jobTitles.get(0));
    }
}
