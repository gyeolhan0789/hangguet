package com.ssafy.a301.home.service;

import com.ssafy.a301.home.domain.Streak;
import com.ssafy.a301.home.dto.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.home.dto.HomeDtos.StatsResponse;
import com.ssafy.a301.home.mapper.HomeMapper;
import com.ssafy.a301.home.repository.PracticeLogRepository;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 3.2 통계·3.3 연습 달력. 연습한 날은 practice_logs, 면접 수·시간은 연습 면접 기준이다(BE 설계 6.1). 스트릭 계산은 3.1 홈에서도 쓴다. */
@Service
public class PracticeStatsService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Set<SessionStatus> PRACTICE_STATUSES =
            Set.of(SessionStatus.ANALYZING, SessionStatus.COMPLETED, SessionStatus.FAILED);

    private final PracticeLogRepository practiceLogs;
    private final InterviewSessionRepository sessions;

    public PracticeStatsService(
            PracticeLogRepository practiceLogs, InterviewSessionRepository sessions) {
        this.practiceLogs = practiceLogs;
        this.sessions = sessions;
    }

    /** 현재·최장 스트릭 */
    public record Streaks(int current, int best) {}

    public StatsResponse stats(long userId) {
        return stats(userId, LocalDate.now(KST));
    }

    @Transactional(readOnly = true)
    public StatsResponse stats(long userId, LocalDate today) {
        Streaks streaks = streaks(userId, today);
        List<String> jobTitles =
                sessions.findPracticeJobTitles(userId, PRACTICE_STATUSES, Limit.of(1));
        return new StatsResponse(
                streaks.current(),
                streaks.best(),
                Math.toIntExact(sessions.countPracticeSessions(userId, PRACTICE_STATUSES)),
                Math.toIntExact(sessions.sumPracticeSeconds(userId) / 60),
                jobTitles.isEmpty() ? null : jobTitles.get(0));
    }

    @Transactional(readOnly = true)
    public Streaks streaks(long userId, LocalDate today) {
        List<LocalDate> practiceDates = practiceLogs.findPracticeDatesByUserId(userId);
        return new Streaks(Streak.current(practiceDates, today), Streak.best(practiceDates));
    }

    @Transactional(readOnly = true)
    public PracticeLogsResponse practiceLogs(long userId, YearMonth month) {
        return HomeMapper.toPracticeLogs(
                practiceLogs.findInRange(userId, month.atDay(1), month.plusMonths(1).atDay(1)));
    }
}
