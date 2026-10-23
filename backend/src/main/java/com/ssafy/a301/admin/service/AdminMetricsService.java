package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.domain.StreakFreezeStatus;
import com.ssafy.a301.admin.dto.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.admin.dto.AdminDtos.CriterionAverage;
import com.ssafy.a301.admin.dto.AdminDtos.DailyPractice;
import com.ssafy.a301.admin.dto.AdminDtos.InterviewMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeMetric;
import com.ssafy.a301.admin.dto.AdminDtos.PracticeMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.UserMetrics;
import com.ssafy.a301.admin.repository.AdminMetricsRepository;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.CriterionScore;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.DailyCount;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.FreezeCounts;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.InterviewCount;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.UserCounts;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.SessionStatus;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 8.15 관리 페이지 홈 집계. 날짜는 한국 시간 오늘 기준이다. */
@Service
public class AdminMetricsService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int DAYS = 7;
    private static final List<SessionStatus> PRACTICED =
            List.of(SessionStatus.ANALYZING, SessionStatus.COMPLETED, SessionStatus.FAILED);

    private final AdminMetricsRepository metrics;

    public AdminMetricsService(AdminMetricsRepository metrics) {
        this.metrics = metrics;
    }

    @Transactional(readOnly = true)
    public AdminMetricsResponse metrics() {
        LocalDate today = LocalDate.now(KST);
        OffsetDateTime now = OffsetDateTime.now(KST);
        return new AdminMetricsResponse(
                today,
                users(today),
                practice(today),
                interviews(),
                averageScores(),
                freezes(now),
                metrics.countNoticeReads(now).stream()
                        .map(n -> new NoticeMetric(n.getId(), n.getTitle(), (int) n.getReadCount()))
                        .toList());
    }

    private UserMetrics users(LocalDate today) {
        UserCounts counts = metrics.countUsers(today.atStartOfDay(KST).toOffsetDateTime());
        return new UserMetrics((int) counts.getTotal(), (int) counts.getJoinedToday());
    }

    // 연습 기록이 없는 날은 0명으로 채운다
    private PracticeMetrics practice(LocalDate today) {
        LocalDate from = today.minusDays(DAYS - 1L);
        Map<LocalDate, Long> counts =
                metrics.countPracticeByDate(from, today).stream()
                        .collect(Collectors.toMap(DailyCount::getDate, DailyCount::getUsers));
        List<DailyPractice> daily =
                IntStream.range(0, DAYS)
                        .mapToObj(from::plusDays)
                        .map(d -> new DailyPractice(d, counts.getOrDefault(d, 0L).intValue()))
                        .toList();
        return new PracticeMetrics(counts.getOrDefault(today, 0L).intValue(), daily);
    }

    private InterviewMetrics interviews() {
        List<InterviewCount> counts = metrics.countInterviews(PRACTICED, SessionStatus.ABORTED);
        int completed = sum(counts, c -> c.getStatus() == SessionStatus.COMPLETED);
        int analyzing = sum(counts, c -> c.getStatus() == SessionStatus.ANALYZING);
        int failed = sum(counts, c -> c.getStatus() == SessionStatus.FAILED);
        int aborted = sum(counts, c -> c.getStatus() == SessionStatus.ABORTED);
        int video =
                sum(
                        counts,
                        c ->
                                c.getStatus() != SessionStatus.ABORTED
                                        && c.getMode() == InterviewMode.VIDEO);
        int chat =
                sum(
                        counts,
                        c ->
                                c.getStatus() != SessionStatus.ABORTED
                                        && c.getMode() == InterviewMode.CHAT);
        return new InterviewMetrics(
                completed + analyzing + failed, completed, analyzing, failed, aborted, video, chat);
    }

    private static int sum(List<InterviewCount> counts, Predicate<InterviewCount> filter) {
        return (int) counts.stream().filter(filter).mapToLong(InterviewCount::getCount).sum();
    }

    // 기준 4개를 정해진 순서로 준다. 결과가 있는 면접이 없으면 0점이다
    private List<CriterionAverage> averageScores() {
        Map<Criterion, Double> scores =
                metrics.averageScores(SessionStatus.COMPLETED).stream()
                        .collect(
                                Collectors.toMap(
                                        CriterionScore::getCriterion, CriterionScore::getScore));
        return Arrays.stream(Criterion.values())
                .map(c -> new CriterionAverage(c, roundOne(scores.getOrDefault(c, 0.0))))
                .toList();
    }

    private static double roundOne(double value) {
        return Math.round(value * 10) / 10.0;
    }

    private StreakFreezeMetrics freezes(OffsetDateTime now) {
        FreezeCounts counts =
                metrics.countFreezes(
                        StreakFreezeStatus.AVAILABLE,
                        StreakFreezeStatus.USED,
                        StreakFreezeStatus.EXPIRED,
                        now);
        return new StreakFreezeMetrics(
                (int) counts.getGranted(), (int) counts.getUsed(), (int) counts.getExpired());
    }
}
