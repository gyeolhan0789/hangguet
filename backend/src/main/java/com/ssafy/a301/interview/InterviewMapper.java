package com.ssafy.a301.interview;

import com.ssafy.a301.interview.InterviewDtos.AnswerResponse;
import com.ssafy.a301.interview.InterviewDtos.CurrentQuestion;
import com.ssafy.a301.interview.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionStatus;
import java.time.OffsetDateTime;

/** 면접 엔티티 + Redis 진행 상태 → API 응답. session.application은 지연 로딩이므로 조회 쿼리에서 함께 가져온다(fetch join). */
public final class InterviewMapper {

    private InterviewMapper() {}

    /**
     * @param currentQuestion 지금 답할 질문(답변이 없는 마지막 질문). 면접 중이 아니거나 다음 질문을 만드는 중이면 null
     * @param answeredCount 지금까지 낸 답변 수
     */
    public static SessionResponse toSessionResponse(
            InterviewSession session,
            SessionRuntime runtime,
            InterviewQuestion currentQuestion,
            int answeredCount,
            OffsetDateTime now) {
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
                session.getCreatedAt());
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

    // isLastQuestion은 전체 질문 수(B-3)와 비교해 서비스가 정한다
    public static AnswerResponse toAnswerResponse(Answer answer, boolean isLastQuestion) {
        return new AnswerResponse(
                answer.getId(),
                answer.getQuestion().getId(),
                answer.getInputType(),
                answer.getCreatedAt(),
                isLastQuestion);
    }
}
