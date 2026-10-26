package com.ssafy.a301.growth.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.growth.dto.GrowthDtos.CriterionReview;
import com.ssafy.a301.growth.dto.GrowthDtos.GrowthReviewResponse;
import com.ssafy.a301.growth.dto.GrowthDtos.RecentReviewItem;
import com.ssafy.a301.home.domain.PracticeLog;
import com.ssafy.a301.home.domain.Streak;
import com.ssafy.a301.home.repository.PracticeLogRepository;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
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
 * 면접이 있는 날. 3.1 홈의 최근 리뷰·오늘 나아진 점·다음에 해볼 것에서도 쓴다.
 */
@Service
public class GrowthReviewService {
    private static final Logger LOG = LoggerFactory.getLogger(GrowthReviewService.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Set<SessionStatus> PRACTICE_STATUSES =
            Set.of(SessionStatus.ANALYZING, SessionStatus.COMPLETED, SessionStatus.FAILED);
    private static final int PRACTICE_DATES_DAYS = 7;

    private final InterviewSessionRepository sessions;
    private final SessionScoreRepository scores;
    private final AnswerRepository answers;
    private final PracticeLogRepository practiceLogs;

    public GrowthReviewService(
            InterviewSessionRepository sessions,
            SessionScoreRepository scores,
            AnswerRepository answers,
            PracticeLogRepository practiceLogs) {
        this.sessions = sessions;
        this.scores = scores;
        this.answers = answers;
        this.practiceLogs = practiceLogs;
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

        List<Object[]> durations =
                sessions.findPracticeDurations(
                        userId,
                        PRACTICE_STATUSES,
                        startOf(practiceDate),
                        startOf(practiceDate.plusDays(1)));
        long practiceSeconds = 0;
        for (Object[] duration : durations) {
            practiceSeconds +=
                    Duration.between((OffsetDateTime) duration[0], (OffsetDateTime) duration[1])
                            .getSeconds();
        }
        List<LocalDate> recentDates =
                practiceLogs
                        .findInRange(
                                userId,
                                practiceDate.minusDays(PRACTICE_DATES_DAYS - 1L),
                                practiceDate.plusDays(1))
                        .stream()
                        .map(PracticeLog::getPracticeDate)
                        .toList();

        List<CriterionReview> criteria = new ArrayList<>();
        for (Criterion criterion : Criterion.values()) {
            int score = day.averages().get(criterion);
            criteria.add(
                    new CriterionReview(
                            criterion,
                            score,
                            Grade.of(score),
                            compared == null ? null : score - compared.averages().get(criterion),
                            day.lastComments().get(criterion)));
        }
        return Optional.of(
                new GrowthReviewResponse(
                        practiceDate,
                        compared == null,
                        compared == null ? null : compared.date(),
                        Streak.current(
                                practiceLogs.findPracticeDatesByUserId(userId), practiceDate),
                        recentDates,
                        durations.size(),
                        Math.toIntExact(practiceSeconds / 60),
                        criteria,
                        nextActions(day)));
    }

    /** 리뷰가 있는 날을 최근 날짜 순으로 준다. 항목의 기준·변화량은 그날 가장 많이 오른 기준이고, 오른 기준이 없으면 null이다. */
    @Transactional(readOnly = true)
    public PagedModel<RecentReviewItem> recent(long userId, int page, int size) {
        List<ReviewDay> days = reviewDays(userId, LocalDate.now(KST).plusDays(1));
        List<RecentReviewItem> items = new ArrayList<>();
        for (int i = days.size() - 1; i >= 0; i--) {
            items.add(toRecentItem(days.get(i), i > 0 ? days.get(i - 1) : null));
        }
        PageRequest pageable = PageRequest.of(page, size);
        long from = Math.min(pageable.getOffset(), items.size());
        int to = (int) Math.min(from + size, items.size());
        return new PagedModel<>(
                new PageImpl<>(items.subList((int) from, to), pageable, items.size()));
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
            if (scoresBySession.getOrDefault(session.getId(), Map.of()).size()
                    != Criterion.values().length) {
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

    private static RecentReviewItem toRecentItem(ReviewDay day, ReviewDay compared) {
        Criterion best = null;
        Integer bestDelta = null;
        if (compared != null) {
            for (Criterion criterion : Criterion.values()) {
                int delta = day.averages().get(criterion) - compared.averages().get(criterion);
                // 오른 기준만 고른다. 모두 그대로거나 떨어졌으면 null
                if (delta > 0 && (bestDelta == null || delta > bestDelta)) {
                    best = criterion;
                    bestDelta = delta;
                }
            }
        }
        return new RecentReviewItem(
                day.date(), day.last().getApplication().getCompanyName(), best, bestDelta);
    }

    private static OffsetDateTime startOf(LocalDate date) {
        return date.atStartOfDay(KST).toOffsetDateTime();
    }
}
