package com.ssafy.a301.interview.service;

import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.DailyInterviewCount;
import com.ssafy.a301.interview.dto.InterviewDtos.PageMetadata;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCalendarResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListItem;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListSummary;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PagedModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InterviewSessionListService {
    private static final Sort RECENT_FIRST =
            Sort.by(Sort.Order.desc("startedAt"), Sort.Order.desc("id"));

    private final InterviewSessionRepository sessions;
    private final AnswerRepository answers;
    private final SessionScoreRepository scores;
    private final InterviewStatsService interviewStats;
    private final ApplicationRepository applications;

    public InterviewSessionListService(
            InterviewSessionRepository sessions,
            AnswerRepository answers,
            SessionScoreRepository scores,
            InterviewStatsService interviewStats,
            ApplicationRepository applications) {
        this.sessions = sessions;
        this.answers = answers;
        this.scores = scores;
        this.interviewStats = interviewStats;
        this.applications = applications;
    }

    @Transactional(readOnly = true)
    public SessionCalendarResponse calendar(long userId, YearMonth month) {
        OffsetDateTime from = KoreaTime.startOfDay(month.atDay(1));
        OffsetDateTime to = KoreaTime.startOfDay(month.plusMonths(1).atDay(1));
        Map<LocalDate, Long> counts =
                sessions
                        .countPracticeByDate(userId, SessionStatus.practiceNames(), from, to)
                        .stream()
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
        OffsetDateTime from = KoreaTime.startOfDay(practiceDate);
        OffsetDateTime to = KoreaTime.startOfDay(practiceDate.plusDays(1));
        PageRequest pageable = PageRequest.of(page, size, RECENT_FIRST);
        // 날짜 전체 건수·시간은 3.1·7.1과 같은 계산(InterviewStatsService.daily)을 쓴다
        InterviewStatsService.DailyPractice daily = interviewStats.daily(userId, practiceDate);
        // JPA는 int 범위의 offset만 지원한다. 그 밖의 페이지도 계약대로 빈 목록과 집계를 준다.
        Page<InterviewSession> found =
                pageable.getOffset() > Integer.MAX_VALUE
                        ? new PageImpl<>(List.of(), pageable, daily.interviewCount())
                        : sessions.findPracticeSessions(
                                userId, SessionStatus.PRACTICE, from, to, pageable);

        List<SessionListItem> content = toListItems(found).getContent();

        long totalInterviewCount = sessions.countPracticeSessions(userId, SessionStatus.PRACTICE);
        return new SessionListResponse(
                content,
                new PageMetadata(
                        found.getSize(),
                        found.getNumber(),
                        found.getTotalElements(),
                        found.getTotalPages()),
                new SessionListSummary(totalInterviewCount, daily.practiceMinutes()));
    }

    /** 4.6. 없거나 남의 지원서 · 지운 지원서는 404. 항목은 5.13과 같다. */
    @Transactional(readOnly = true)
    public PagedModel<SessionListItem> listByApplication(
            long userId, long applicationId, int page, int size) {
        if (!applications.existsByIdAndUserIdAndDeletedAtIsNull(applicationId, userId)) {
            throw new ApiException(ErrorCode.APPLICATION_NOT_FOUND);
        }
        PageRequest pageable = PageRequest.of(page, size, RECENT_FIRST);
        // JPA는 int 범위의 offset만 지원한다. 그 밖의 페이지는 빈 목록과 전체 건수를 준다.
        Page<InterviewSession> found =
                pageable.getOffset() > Integer.MAX_VALUE
                        ? new PageImpl<>(
                                List.of(),
                                pageable,
                                sessions.findApplicationSessions(
                                                userId,
                                                applicationId,
                                                SessionStatus.PRACTICE,
                                                PageRequest.of(0, 1))
                                        .getTotalElements())
                        : sessions.findApplicationSessions(
                                userId, applicationId, SessionStatus.PRACTICE, pageable);
        return new PagedModel<>(toListItems(found));
    }

    private Page<SessionListItem> toListItems(Page<InterviewSession> found) {
        List<Long> sessionIds = found.stream().map(InterviewSession::getId).toList();
        List<Long> completedSessionIds =
                found.stream()
                        .filter(session -> session.getStatus() == SessionStatus.COMPLETED)
                        .map(InterviewSession::getId)
                        .toList();
        Map<Long, Long> answerCounts = answerCounts(sessionIds);
        Map<Long, Map<Criterion, Grade>> grades = grades(completedSessionIds);
        return found.map(session -> toListItem(session, answerCounts, grades));
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
        Map<Criterion, Grade> sessionGrades = grades.getOrDefault(session.getId(), Map.of());
        // 완료 결과는 기준 4개가 있어야 한다. 저장이 불완전한 결과를 정상 평가로 노출하지 않는다.
        if (session.getStatus() == SessionStatus.COMPLETED
                && !Criterion.coversAllOnce(sessionGrades.keySet())) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR);
        }
        return InterviewMapper.toListItem(
                session,
                Math.toIntExact(answerCounts.getOrDefault(session.getId(), 0L)),
                sessionGrades);
    }
}
