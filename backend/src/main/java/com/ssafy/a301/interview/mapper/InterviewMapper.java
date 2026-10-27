package com.ssafy.a301.interview.mapper;

import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.AnswerResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.CriterionGrade;
import com.ssafy.a301.interview.dto.InterviewDtos.CurrentQuestion;
import com.ssafy.a301.interview.dto.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListItem;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** 면접 엔티티 + Redis 진행 상태 → API 응답. session.application은 지연 로딩이므로 조회 쿼리에서 함께 가져온다(fetch join). */
public final class InterviewMapper {

    private InterviewMapper() {}

    /**
     * @param currentQuestion 지금 답할 질문(답변이 없는 마지막 질문). 면접 중이 아니거나 다음 질문을 만드는 중이면 null
     * @param answeredCount 지금까지 낸 답변 수
     * @param leveledUp 이번 끝내기로 뱃지 구간이 바뀌었는지. 5.8 응답에서만 넘기고 그 외에는 null
     */
    public static SessionResponse toSessionResponse(
            InterviewSession session,
            SessionRuntime runtime,
            InterviewQuestion currentQuestion,
            int answeredCount,
            OffsetDateTime now,
            Boolean leveledUp) {
        return toSessionResponse(
                session, runtime, currentQuestion, answeredCount, now, leveledUp, null);
    }

    /**
     * @param room 면접방 입장 정보. 5.4 응답에서만 넘기고 그 외에는 null
     */
    public static SessionResponse toSessionResponse(
            InterviewSession session,
            SessionRuntime runtime,
            InterviewQuestion currentQuestion,
            int answeredCount,
            OffsetDateTime now,
            Boolean leveledUp,
            RoomResponse room) {
        boolean generating = runtime.planStatus() == PlanStatus.GENERATING;
        boolean analyzing = session.getStatus() == SessionStatus.ANALYZING;
        boolean inProgress = session.getStatus() == SessionStatus.IN_PROGRESS;
        return new SessionResponse(
                session.getId(),
                session.getApplication().getId(),
                session.getApplication().getCompanyName(),
                session.getApplication().getJobTitle(),
                session.getPersona(),
                session.getMode(),
                session.getStatus(),
                runtime.planStatus(),
                generating ? runtime.planProgress() : null,
                analyzing ? runtime.analysisStep() : null,
                inProgress && currentQuestion != null ? toCurrentQuestion(currentQuestion) : null,
                answeredCount,
                runtime.elapsedSeconds(session, now),
                session.getStartedAt(),
                session.getEndedAt(),
                session.getCreatedAt(),
                leveledUp,
                room);
    }

    public static CurrentQuestion toCurrentQuestion(InterviewQuestion question) {
        return new CurrentQuestion(question.getId(), question.getSeq(), question.getContent());
    }

    public static QuestionResponse toQuestionResponse(InterviewQuestion question) {
        return new QuestionResponse(
                question.getId(),
                question.getSeq(),
                question.getContent(),
                question.getCreatedAt());
    }

    // isLastQuestion은 전체 질문 수(5개 고정, API 명세 5.2)와 비교해 서비스가 정한다
    public static AnswerResponse toAnswerResponse(Answer answer, boolean isLastQuestion) {
        return new AnswerResponse(
                answer.getId(),
                answer.getQuestion().getId(),
                answer.getInputType(),
                answer.getCreatedAt(),
                isLastQuestion);
    }

    /**
     * 5.14 목록 항목. 요약·기준별 등급은 완료(COMPLETED)일 때만 채운다.
     *
     * @param grades 완료 면접의 기준 4개 등급. 빠진 기준이 없는지는 서비스가 먼저 확인한다
     */
    public static SessionListItem toListItem(
            InterviewSession session, int answeredCount, Map<Criterion, Grade> grades) {
        boolean completed = session.getStatus() == SessionStatus.COMPLETED;
        List<CriterionGrade> criterionGrades =
                completed
                        ? Arrays.stream(Criterion.values())
                                .map(c -> new CriterionGrade(c, grades.get(c)))
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
                answeredCount,
                completed ? session.getHeadline() : null,
                criterionGrades);
    }
}
