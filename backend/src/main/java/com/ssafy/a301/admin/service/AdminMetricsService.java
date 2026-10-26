package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.domain.StreakFreezeStatus;
import com.ssafy.a301.admin.dto.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.admin.dto.AdminDtos.CriterionAverage;
import com.ssafy.a301.admin.dto.AdminDtos.DailyPractice;
import com.ssafy.a301.admin.dto.AdminDtos.InquiryMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.InterviewMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeMetric;
import com.ssafy.a301.admin.dto.AdminDtos.PersonaCount;
import com.ssafy.a301.admin.dto.AdminDtos.PracticeMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.Retention;
import com.ssafy.a301.admin.dto.AdminDtos.SpeechAverages;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.UserMetrics;
import com.ssafy.a301.admin.repository.AdminMetricsRepository;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.CriterionScore;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.DailyCount;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.FreezeCounts;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.InterviewCount;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.RetentionCount;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.SpeechAverage;
import com.ssafy.a301.admin.repository.AdminMetricsRepository.UserCounts;
import com.ssafy.a301.inquiry.domain.InquiryStatus;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.SessionStatus;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 8.15 관리 페이지 홈 집계. 날짜는 한국 시간 오늘 기준이다. */
@Service
public class AdminMetricsService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int DAYS = 7;
    private static final List<Integer> RETENTION_DAYS = List.of(1, 3, 7);
    private static final List<SessionStatus> PRACTICED =
            List.of(SessionStatus.ANALYZING, SessionStatus.COMPLETED, SessionStatus.FAILED);

    private final AdminMetricsRepository metrics;
    private final Duration analysisTimeout;

    public AdminMetricsService(
            AdminMetricsRepository metrics,
            @Value("${ai-job.analysis-timeout:10m}") Duration analysisTimeout) {
        this.metrics = metrics;
        this.analysisTimeout = analysisTimeout;
    }

    @Transactional(readOnly = true)
    public AdminMetricsResponse metrics() {
        return metrics(LocalDate.now(KST), OffsetDateTime.now(KST));
    }

    /**
     * today를 기준 날짜로 집계한다. 날짜로 정해지는 값(가입 · 연습 · 재방문)은 today 기준, 상태가 바뀌는 값(회원 · 면접 · 문의 · 유지권 수)은 now
     * 시각 기준이다. 일별 기록(8.16)은 0시에 전날을 today로 넘긴다
     */
    @Transactional(readOnly = true)
    public AdminMetricsResponse metrics(LocalDate today, OffsetDateTime now) {
        return new AdminMetricsResponse(
                today,
                users(today),
                practice(today),
                interviews(now),
                averageScores(),
                speech(),
                (int) metrics.countApplications(),
                new InquiryMetrics((int) metrics.countInquiries(InquiryStatus.WAITING)),
                freezes(now),
                metrics.countNoticeReads(now).stream()
                        .map(n -> new NoticeMetric(n.getId(), n.getTitle(), (int) n.getReadCount()))
                        .toList());
    }

    private UserMetrics users(LocalDate today) {
        UserCounts counts =
                metrics.countUsers(
                        today.atStartOfDay(KST).toOffsetDateTime(),
                        today.plusDays(1).atStartOfDay(KST).toOffsetDateTime());
        return new UserMetrics(
                (int) counts.getTotal(),
                (int) counts.getJoinedToday(),
                (int) counts.getWithdrawn(),
                (int) metrics.countInterviewedUsers(PRACTICED));
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
        return new PracticeMetrics(
                counts.getOrDefault(today, 0L).intValue(),
                (int) metrics.countPracticedUsers(from, today),
                daily,
                retention(today));
    }

    // D-n은 가입한 날에서 n일째가 오늘까지 온 회원(오늘 - n일 이전 가입)만 대상으로 한다
    private List<Retention> retention(LocalDate today) {
        return RETENTION_DAYS.stream()
                .map(
                        days -> {
                            RetentionCount count =
                                    metrics.countRetention(days, today.minusDays(days));
                            return new Retention(
                                    days, (int) count.getEligible(), (int) count.getReturned());
                        })
                .toList();
    }

    private InterviewMetrics interviews(OffsetDateTime now) {
        List<InterviewCount> counts = metrics.countInterviews(PRACTICED, SessionStatus.ABORTED);
        int completed = sum(counts, c -> c.getStatus() == SessionStatus.COMPLETED);
        int analyzing = sum(counts, c -> c.getStatus() == SessionStatus.ANALYZING);
        int failed = sum(counts, c -> c.getStatus() == SessionStatus.FAILED);
        int aborted = sum(counts, c -> c.getStatus() == SessionStatus.ABORTED);
        // 방식·면접관별 수는 total(답변 없이 끝난 면접 제외) 안에서 나눈다
        Predicate<InterviewCount> practiced = c -> c.getStatus() != SessionStatus.ABORTED;
        int video = sum(counts, practiced.and(c -> c.getMode() == InterviewMode.VIDEO));
        int chat = sum(counts, practiced.and(c -> c.getMode() == InterviewMode.CHAT));
        List<PersonaCount> personas =
                Arrays.stream(Persona.values())
                        .map(
                                p ->
                                        new PersonaCount(
                                                p,
                                                sum(
                                                        counts,
                                                        practiced.and(c -> c.getPersona() == p))))
                        .toList();
        int stuck =
                (int)
                        metrics.countStuckAnalyses(
                                SessionStatus.ANALYZING,
                                AiJobType.EVALUATE,
                                now.minus(analysisTimeout));
        return new InterviewMetrics(
                completed + analyzing + failed,
                completed,
                analyzing,
                failed,
                aborted,
                video,
                chat,
                stuck,
                personas);
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

    private SpeechAverages speech() {
        SpeechAverage avg = metrics.averageSpeech(SessionStatus.COMPLETED);
        return new SpeechAverages(
                (int) avg.getSessions(),
                roundOneOrNull(avg.getFillerPerMin()),
                roundOneOrNull(avg.getLongPauseCount()),
                roundOneOrNull(avg.getSpeedDeviationPct()),
                roundOneOrNull(avg.getTrailingOffRatio()),
                roundOneOrNull(avg.getPitchRangeSt()),
                roundOneOrNull(avg.getGazeRatio()));
    }

    private static double roundOne(double value) {
        return Math.round(value * 10) / 10.0;
    }

    private static Double roundOneOrNull(Double value) {
        return value == null ? null : roundOne(value);
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
