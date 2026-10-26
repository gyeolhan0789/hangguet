package com.ssafy.a301.home.service;

import com.ssafy.a301.home.domain.PracticeLog;
import com.ssafy.a301.home.domain.Streak;
import com.ssafy.a301.home.dto.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.home.dto.HomeDtos.StatsResponse;
import com.ssafy.a301.home.mapper.HomeMapper;
import com.ssafy.a301.home.repository.PracticeLogRepository;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.List;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 3.2 통계·3.3 연습 달력. 연습한 날은 practice_logs, 면접 수·시간은 연습 면접 기준이다(BE 설계 6.1). 스트릭·최근 7일 연습일·그날 면접 수와
 * 시간은 3.1 홈·7.1 성장 리뷰에서도 쓴다.
 */
@Service
public class PracticeStatsService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int RECENT_DAYS = 7;

    private final PracticeLogRepository practiceLogs;
    private final InterviewSessionRepository sessions;

    public PracticeStatsService(
            PracticeLogRepository practiceLogs, InterviewSessionRepository sessions) {
        this.practiceLogs = practiceLogs;
        this.sessions = sessions;
    }

    /** 현재·최장 스트릭 */
    public record Streaks(int current, int best) {}

    /** 그날(한국 시간 시작일) 연습 면접 수와 연습 시간(분) */
    public record DailyPractice(int interviewCount, int practiceMinutes) {}

    // 아래 stats(userId, today)를 같은 객체 안에서 부르면 그쪽 @Transactional이 적용되지 않으므로 여기에도 둔다(3.1 홈과 같음)
    @Transactional(readOnly = true)
    public StatsResponse stats(long userId) {
        return stats(userId, LocalDate.now(KST));
    }

    @Transactional(readOnly = true)
    public StatsResponse stats(long userId, LocalDate today) {
        Streaks streaks = streaks(userId, today);
        List<String> jobTitles =
                sessions.findPracticeJobTitles(userId, SessionStatus.PRACTICE, Limit.of(1));
        return new StatsResponse(
                streaks.current(),
                streaks.best(),
                Math.toIntExact(sessions.countPracticeSessions(userId, SessionStatus.PRACTICE)),
                Math.toIntExact(
                        sessions.sumPracticeSeconds(userId, SessionStatus.practiceNames()) / 60),
                jobTitles.isEmpty() ? null : jobTitles.get(0));
    }

    @Transactional(readOnly = true)
    public Streaks streaks(long userId, LocalDate today) {
        List<LocalDate> practiceDates = practiceLogs.findPracticeDatesByUserId(userId);
        return new Streaks(Streak.current(practiceDates, today), Streak.best(practiceDates));
    }

    /** 그날 포함 최근 7일 중 연습한 날, 날짜 오름차순 */
    @Transactional(readOnly = true)
    public List<LocalDate> recentPracticeDates(long userId, LocalDate date) {
        return practiceLogs
                .findInRange(userId, date.minusDays(RECENT_DAYS - 1L), date.plusDays(1))
                .stream()
                .map(PracticeLog::getPracticeDate)
                .toList();
    }

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
    public PracticeLogsResponse practiceLogs(long userId, YearMonth month) {
        return HomeMapper.toPracticeLogs(
                practiceLogs.findInRange(userId, month.atDay(1), month.plusMonths(1).atDay(1)));
    }
}
