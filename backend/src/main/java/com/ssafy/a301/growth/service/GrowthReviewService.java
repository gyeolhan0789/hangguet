package com.ssafy.a301.growth.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.growth.dto.GrowthDtos.CriterionReview;
import com.ssafy.a301.growth.dto.GrowthDtos.GrowthReviewResponse;
import com.ssafy.a301.growth.dto.GrowthDtos.Improvement;
import com.ssafy.a301.growth.dto.GrowthDtos.RecentReviewItem;
import com.ssafy.a301.growth.mapper.GrowthMapper;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import com.ssafy.a301.interview.service.InterviewStatsService;
import com.ssafy.a301.interview.service.InterviewStatsService.DailyPractice;
import com.ssafy.a301.practice.service.PracticeService;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.web.PagedModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 7.1·7.2 성장 리뷰(BE 설계 6.2). 저장하지 않고 session_scores·answers로 계산한다. 리뷰가 있는 날 = 한국 시간으로 그날 시작한 결과 완료
 * 면접이 있는 날. 3.1 홈의 최근 리뷰·오늘 나아진 점·다음에 해볼 것은 homeReviews로 한 번에 만든다. 그날 면접 수·시간은
 * InterviewStatsService, 최근 7일 연습일·스트릭은 PracticeService 계산을 쓴다.
 */
@Service
public class GrowthReviewService {
    private static final Logger LOG = LoggerFactory.getLogger(GrowthReviewService.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int HOME_RECENT_REVIEWS = 2;

    private final InterviewSessionRepository sessions;
    private final SessionScoreRepository scores;
    private final AnswerRepository answers;
    private final PracticeService practices;
    private final InterviewStatsService interviewStats;

    public GrowthReviewService(
            InterviewSessionRepository sessions,
            SessionScoreRepository scores,
            AnswerRepository answers,
            PracticeService practices,
            InterviewStatsService interviewStats) {
        this.sessions = sessions;
        this.scores = scores;
        this.answers = answers;
        this.practices = practices;
        this.interviewStats = interviewStats;
    }

    /** 그날 결과 완료 면접들(시작 순)과 그 기준 점수(면접 순·기준 순), 기준별 평균 점수와 마지막 면접의 코멘트 */
    private record ReviewDay(
            LocalDate date,
            List<InterviewSession> sessions,
            List<SessionScore> scores,
            Map<Criterion, Integer> averages,
            Map<Criterion, String> lastComments) {

        InterviewSession last() {
            return sessions.get(sessions.size() - 1);
        }
    }

    /**
     * 3.1 홈에 쓰는 성장 리뷰 값. 오늘 나아진 점(오늘 리뷰가 없으면 빈 배열), 가장 최근 리뷰의 다음에 해볼 것과 그 날짜(없으면 빈 배열·null), 최근 리뷰
     * 2개(7.2 첫 페이지와 같음)
     */
    public record HomeReviews(
            List<Improvement> todayImprovements,
            List<String> nextActions,
            LocalDate nextActionsDate,
            List<RecentReviewItem> recentReviews) {}

    /** 그날 리뷰가 없으면 404 GROWTH_REVIEW_NOT_FOUND */
    @Transactional(readOnly = true)
    public GrowthReviewResponse review(long userId, LocalDate practiceDate) {
        return findReview(userId, practiceDate)
                .orElseThrow(() -> new ApiException(ErrorCode.GROWTH_REVIEW_NOT_FOUND));
    }

    @Transactional(readOnly = true)
    public Optional<GrowthReviewResponse> findReview(long userId, LocalDate practiceDate) {
        List<ReviewDay> days = reviewDays(userId, practiceDate.plusDays(1));
        if (days.isEmpty() || !days.get(days.size() - 1).date().equals(practiceDate)) {
            return Optional.empty();
        }
        ReviewDay day = days.get(days.size() - 1);
        ReviewDay compared = days.size() > 1 ? days.get(days.size() - 2) : null;

        DailyPractice daily = interviewStats.daily(userId, practiceDate);
        List<CriterionReview> criteria = new ArrayList<>();
        for (Criterion criterion : Criterion.values()) {
            criteria.add(
                    GrowthMapper.toCriterionReview(
                            criterion,
                            day.averages().get(criterion),
                            compared == null ? null : compared.averages().get(criterion),
                            day.lastComments().get(criterion)));
        }
        return Optional.of(
                new GrowthReviewResponse(
                        practiceDate,
                        compared == null,
                        compared == null ? null : compared.date(),
                        practices.streaks(userId, practiceDate).current(),
                        practices.recentPracticeDates(userId, practiceDate),
                        daily.interviewCount(),
                        daily.practiceMinutes(),
                        criteria,
                        nextActions(day)));
    }

    /** 리뷰가 있는 날을 최근 날짜 순으로 준다. 항목의 기준·변화량은 그날 가장 많이 오른 기준이고, 오른 기준이 없으면 null이다. */
    @Transactional(readOnly = true)
    public PagedModel<RecentReviewItem> recent(long userId, int page, int size) {
        List<RecentReviewItem> items =
                recentItems(reviewDays(userId, LocalDate.now(KST).plusDays(1)));
        PageRequest pageable = PageRequest.of(page, size);
        long from = Math.min(pageable.getOffset(), items.size());
        int to = (int) Math.min(from + size, items.size());
        return new PagedModel<>(
                new PageImpl<>(items.subList((int) from, to), pageable, items.size()));
    }

    /** 리뷰 계산을 한 번만 해서 홈에 필요한 값을 함께 만든다 */
    @Transactional(readOnly = true)
    public HomeReviews homeReviews(long userId, LocalDate today) {
        List<ReviewDay> days = reviewDays(userId, today.plusDays(1));
        if (days.isEmpty()) {
            return new HomeReviews(List.of(), List.of(), null, List.of());
        }
        ReviewDay latest = days.get(days.size() - 1);
        List<Improvement> todayImprovements =
                latest.date().equals(today) && days.size() > 1
                        ? improvements(latest, days.get(days.size() - 2))
                        : List.of();
        List<RecentReviewItem> recent = recentItems(days);
        List<String> nextActions = nextActions(latest);
        // 문구가 모두 비어 다음에 해볼 것이 없으면 날짜도 주지 않는다(빈 배열·null을 함께)
        return new HomeReviews(
                todayImprovements,
                nextActions,
                nextActions.isEmpty() ? null : latest.date(),
                recent.subList(0, Math.min(HOME_RECENT_REVIEWS, recent.size())));
    }

    /** 리뷰가 있는 날을 최근 날짜 순으로. 기준·변화량은 그날 가장 많이 오른 기준이고, 오른 기준이 없으면 null */
    private static List<RecentReviewItem> recentItems(List<ReviewDay> days) {
        List<RecentReviewItem> items = new ArrayList<>();
        for (int i = days.size() - 1; i >= 0; i--) {
            ReviewDay day = days.get(i);
            List<Improvement> improved = i > 0 ? improvements(day, days.get(i - 1)) : List.of();
            Improvement best = improved.isEmpty() ? null : improved.get(0);
            items.add(GrowthMapper.toRecentReviewItem(day.date(), day.last(), best));
        }
        return items;
    }

    /** 비교한 날보다 오른 기준(delta > 0), 많이 오른 순. 같으면 기준 순서(JOB_FIT·COVER_LETTER·LOGIC·DELIVERY) */
    private static List<Improvement> improvements(ReviewDay day, ReviewDay compared) {
        List<Improvement> improved = new ArrayList<>();
        for (Criterion criterion : Criterion.values()) {
            int delta = day.averages().get(criterion) - compared.averages().get(criterion);
            if (delta > 0) {
                improved.add(new Improvement(criterion, delta));
            }
        }
        improved.sort(Comparator.comparingInt(Improvement::delta).reversed());
        return improved;
    }

    private List<ReviewDay> reviewDays(long userId, LocalDate until) {
        List<InterviewSession> found =
                sessions.findReviewSessions(userId, SessionStatus.COMPLETED, startOf(until));
        if (found.isEmpty()) {
            return List.of();
        }
        Map<Long, Map<Criterion, SessionScore>> scoresBySession = new HashMap<>();
        for (SessionScore score :
                scores.findBySessionIds(found.stream().map(InterviewSession::getId).toList())) {
            scoresBySession
                    .computeIfAbsent(
                            score.getSession().getId(), ignored -> new EnumMap<>(Criterion.class))
                    .put(score.getCriterion(), score);
        }
        Map<LocalDate, List<InterviewSession>> byDate = new TreeMap<>();
        for (InterviewSession session : found) {
            // 완료 결과는 기준 4개가 있어야 한다. 불완전한 결과는 점수에 넣지 않는다. 과거 면접 하나 때문에 이후 리뷰가 모두 실패하지 않도록
            // 오류 대신 건너뛴다.
            if (!Criterion.coversAllOnce(
                    scoresBySession.getOrDefault(session.getId(), Map.of()).keySet())) {
                LOG.warn("기준 점수가 4개가 아닌 완료 면접을 성장 리뷰에서 뺐다: sessionId={}", session.getId());
                continue;
            }
            byDate.computeIfAbsent(
                            session.getStartedAt().atZoneSameInstant(KST).toLocalDate(),
                            ignored -> new ArrayList<>())
                    .add(session);
        }
        List<ReviewDay> days = new ArrayList<>();
        byDate.forEach(
                (date, daySessions) -> days.add(toReviewDay(date, daySessions, scoresBySession)));
        return days;
    }

    private static ReviewDay toReviewDay(
            LocalDate date,
            List<InterviewSession> daySessions,
            Map<Long, Map<Criterion, SessionScore>> scoresBySession) {
        List<SessionScore> dayScores = new ArrayList<>();
        for (InterviewSession session : daySessions) {
            dayScores.addAll(scoresBySession.get(session.getId()).values());
        }
        Map<Criterion, Integer> averages = new EnumMap<>(Criterion.class);
        Map<Criterion, String> lastComments = new EnumMap<>(Criterion.class);
        Map<Criterion, SessionScore> lastScores =
                scoresBySession.get(daySessions.get(daySessions.size() - 1).getId());
        for (Criterion criterion : Criterion.values()) {
            double average =
                    daySessions.stream()
                            .mapToInt(s -> scoresBySession.get(s.getId()).get(criterion).getScore())
                            .average()
                            .orElseThrow();
            averages.put(criterion, (int) Math.round(average));
            lastComments.put(criterion, lastScores.get(criterion).getComment());
        }
        return new ReviewDay(date, daySessions, dayScores, averages, lastComments);
    }

    /**
     * 그날 기준 코멘트·질문별 고칠 점 중 가장 낮은 점수의 문구. 문구가 빈 것은 건너뛰고, 동점이면 모두. 순서는 면접 시작 순으로 기준 코멘트(기준 순) 다음에 고칠
     * 점(질문 순)이다.
     */
    private List<String> nextActions(ReviewDay day) {
        Map<Integer, Set<String>> byScore = new TreeMap<>();
        for (SessionScore score : day.scores()) {
            addAction(byScore, score.getScore(), score.getComment());
        }
        Map<Long, List<Answer>> answersBySession = new HashMap<>();
        for (Answer answer :
                answers.findWithQuestionBySessionIds(
                        day.sessions().stream().map(InterviewSession::getId).toList())) {
            answersBySession
                    .computeIfAbsent(
                            answer.getQuestion().getSession().getId(), ignored -> new ArrayList<>())
                    .add(answer);
        }
        for (InterviewSession session : day.sessions()) {
            for (Answer answer : answersBySession.getOrDefault(session.getId(), List.of())) {
                addAction(byScore, answer.getScore(), answer.getImprovePoint());
            }
        }
        return byScore.isEmpty() ? List.of() : List.copyOf(byScore.values().iterator().next());
    }

    private static void addAction(Map<Integer, Set<String>> byScore, Integer score, String text) {
        if (score != null && text != null && !text.isBlank()) {
            byScore.computeIfAbsent(score, ignored -> new LinkedHashSet<>()).add(text.strip());
        }
    }

    private static OffsetDateTime startOf(LocalDate date) {
        return date.atStartOfDay(KST).toOffsetDateTime();
    }
}
