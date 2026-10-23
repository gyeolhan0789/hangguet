package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.CriterionGrade;
import com.ssafy.a301.interview.dto.InterviewDtos.DailyInterviewCount;
import com.ssafy.a301.interview.dto.InterviewDtos.PageMetadata;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCalendarResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListItem;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListSummary;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InterviewSessionListService {
    private static final ZoneId KOREA = ZoneId.of("Asia/Seoul");
    private static final Set<SessionStatus> PRACTICE_STATUSES =
            Set.of(SessionStatus.ANALYZING, SessionStatus.COMPLETED, SessionStatus.FAILED);
    private static final Sort RECENT_FIRST =
            Sort.by(Sort.Order.desc("startedAt"), Sort.Order.desc("id"));

    private final InterviewSessionRepository sessions;
    private final AnswerRepository answers;
    private final SessionScoreRepository scores;

    public InterviewSessionListService(
            InterviewSessionRepository sessions,
            AnswerRepository answers,
            SessionScoreRepository scores) {
        this.sessions = sessions;
        this.answers = answers;
        this.scores = scores;
    }

    @Transactional(readOnly = true)
    public SessionCalendarResponse calendar(long userId, YearMonth month) {
        OffsetDateTime from = month.atDay(1).atStartOfDay(KOREA).toOffsetDateTime();
        OffsetDateTime to = month.plusMonths(1).atDay(1).atStartOfDay(KOREA).toOffsetDateTime();
        Map<LocalDate, Long> counts =
                sessions.countPracticeByDate(userId, from, to).stream()
                        .collect(
                                Collectors.toMap(
                                        InterviewSessionRepository.PracticeDateCount
                                                ::getPracticeDate,
                                        InterviewSessionRepository.PracticeDateCount
                                                ::getInterviewCount));
        List<DailyInterviewCount> content =
                IntStream.rangeClosed(1, month.lengthOfMonth())
                        .mapToObj(
                                day ->
                                        new DailyInterviewCount(
                                                month.atDay(day),
                                                counts.getOrDefault(month.atDay(day), 0L)))
                        .toList();
        return new SessionCalendarResponse(month.toString(), content);
    }

    @Transactional(readOnly = true)
    public SessionListResponse list(long userId, LocalDate practiceDate, int page, int size) {
        OffsetDateTime from = practiceDate.atStartOfDay(KOREA).toOffsetDateTime();
        OffsetDateTime to = practiceDate.plusDays(1).atStartOfDay(KOREA).toOffsetDateTime();
        PageRequest pageable = PageRequest.of(page, size, RECENT_FIRST);
        List<Object[]> dailyDurations =
                sessions.findPracticeDurations(userId, PRACTICE_STATUSES, from, to);
        // JPA는 int 범위의 offset만 지원한다. 그 밖의 페이지도 계약대로 빈 목록과 집계를 준다.
        Page<InterviewSession> found =
                pageable.getOffset() > Integer.MAX_VALUE
                        ? new PageImpl<>(List.of(), pageable, dailyDurations.size())
                        : sessions.findPracticeSessions(
                                userId, PRACTICE_STATUSES, from, to, pageable);

        List<Long> sessionIds = found.stream().map(InterviewSession::getId).toList();
        List<Long> completedSessionIds =
                found.stream()
                        .filter(session -> session.getStatus() == SessionStatus.COMPLETED)
                        .map(InterviewSession::getId)
                        .toList();
        Map<Long, Long> answerCounts = answerCounts(sessionIds);
        Map<Long, Map<Criterion, Grade>> grades = grades(completedSessionIds);
        List<SessionListItem> content =
                found.stream().map(session -> toListItem(session, answerCounts, grades)).toList();

        long totalInterviewCount = sessions.countPracticeSessions(userId, PRACTICE_STATUSES);
        long practiceSeconds =
                dailyDurations.stream()
                        .mapToLong(InterviewSessionListService::durationSeconds)
                        .sum();
        return new SessionListResponse(
                content,
                new PageMetadata(
                        found.getSize(),
                        found.getNumber(),
                        found.getTotalElements(),
                        found.getTotalPages()),
                new SessionListSummary(totalInterviewCount, practiceSeconds / 60));
    }

    private Map<Long, Long> answerCounts(List<Long> sessionIds) {
        if (sessionIds.isEmpty()) {
            return Map.of();
        }
        return answers.countBySessionIds(sessionIds).stream()
                .collect(
                        Collectors.toMap(
                                AnswerRepository.SessionAnswerCount::getSessionId,
                                AnswerRepository.SessionAnswerCount::getAnsweredCount));
    }

    private Map<Long, Map<Criterion, Grade>> grades(List<Long> sessionIds) {
        if (sessionIds.isEmpty()) {
            return Map.of();
        }
        Map<Long, Map<Criterion, Grade>> result = new HashMap<>();
        for (SessionScore score : scores.findBySessionIds(sessionIds)) {
            result.computeIfAbsent(
                            score.getSession().getId(), ignored -> new EnumMap<>(Criterion.class))
                    .put(score.getCriterion(), Grade.of(score.getScore()));
        }
        return result;
    }

    private static SessionListItem toListItem(
            InterviewSession session,
            Map<Long, Long> answerCounts,
            Map<Long, Map<Criterion, Grade>> grades) {
        boolean completed = session.getStatus() == SessionStatus.COMPLETED;
        Map<Criterion, Grade> sessionGrades = grades.getOrDefault(session.getId(), Map.of());
        // 완료 결과는 기준 4개가 있어야 한다. 저장이 불완전한 결과를 정상 평가로 노출하지 않는다.
        if (completed && sessionGrades.size() != Criterion.values().length) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR);
        }
        List<CriterionGrade> criterionGrades =
                completed
                        ? Arrays.stream(Criterion.values())
                                .map(c -> new CriterionGrade(c, sessionGrades.get(c)))
                                .toList()
                        : List.of();
        return new SessionListItem(
                session.getId(),
                session.getApplication().getCompanyName(),
                session.getApplication().getJobTitle(),
                session.getPersona(),
                session.getMode(),
                session.getStatus(),
                session.getStartedAt(),
                session.getEndedAt(),
                Math.toIntExact(answerCounts.getOrDefault(session.getId(), 0L)),
                completed ? session.getSummary() : null,
                criterionGrades);
    }

    private static long durationSeconds(Object[] duration) {
        OffsetDateTime startedAt = (OffsetDateTime) duration[0];
        OffsetDateTime endedAt = (OffsetDateTime) duration[1];
        return Duration.between(startedAt, endedAt).getSeconds();
    }
}
