package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.group.service.GroupTurnService;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.AnswerRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.AnswerResponse;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 5.7 채팅 답변. 질문 하나에 답변 하나이며, 저장할 때 채점 작업(SCORE_ANSWER)을 넣는다. 다음 질문은 AI 에이전트가 말할
 * 때(`question.started`) 생기므로 여기서 만들지 않는다. 화상 답변은 결과 큐(`answer.completed`)로 저장한다(BE 설계 5.3). 그룹 면접은
 * GroupTurnService가 그룹 행부터 잠그고 지금 차례인지 확인한다(API 명세 10.10).
 */
@Service
public class AnswerService {

    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final AiJobService aiJobs;
    private final TransactionTemplate transactions;
    private final GroupTurnService groupTurns;

    public AnswerService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            AiJobService aiJobs,
            TransactionTemplate transactions,
            GroupTurnService groupTurns) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.aiJobs = aiJobs;
        this.transactions = transactions;
        this.groupTurns = groupTurns;
    }

    /** 5.7. 같은 면접의 답변 제출이 겹쳐도 면접 행을 잠가 한 번만 저장한다. */
    public AnswerResponse submit(
            long userId, long sessionId, long questionId, AnswerRequest request) {
        InterviewSession found =
                sessions.findByIdAndUserId(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        // 잠금 순서: 그룹 → 면접
        if (found.isGroup()) {
            validate(found, request);
            return groupTurns.submitChat(
                    found.getGroupId(), sessionId, questionId, request.content());
        }
        return transactions.execute(
                status -> {
                    InterviewSession session =
                            sessions.findForUpdate(sessionId, userId)
                                    .orElseThrow(
                                            () -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
                    InterviewQuestion question = requireQuestion(sessionId, questionId);
                    if (session.getStatus() != SessionStatus.IN_PROGRESS) {
                        throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                    }
                    if (answers.existsByQuestionId(questionId)) {
                        throw new ApiException(ErrorCode.ANSWER_ALREADY_SUBMITTED);
                    }
                    validate(session, request);
                    Answer answer =
                            answers.save(new Answer(question, InputType.TEXT, request.content()));
                    aiJobs.enqueue(AiJob.scoreAnswer(sessionId, answer.getId()));
                    return InterviewMapper.toAnswerResponse(
                            answer, question.getSeq() >= InterviewPlan.QUESTION_COUNT);
                });
    }

    /** 10.9. 그룹 채팅 면접의 작성 중인 글. 개인 면접은 쓰지 않으므로 409 QUESTION_CLOSED */
    public void saveDraft(long userId, long sessionId, long questionId, String content) {
        InterviewSession session =
                sessions.findByIdAndUserId(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (!session.isGroup() || session.getStatus() != SessionStatus.IN_PROGRESS) {
            requireQuestion(sessionId, questionId);
            throw new ApiException(ErrorCode.QUESTION_CLOSED);
        }
        groupTurns.saveDraft(session.getGroupId(), sessionId, questionId, content);
    }

    // 경로의 면접에 속하고 이미 낸 질문이어야 한다
    private InterviewQuestion requireQuestion(long sessionId, long questionId) {
        return questions
                .findById(questionId)
                .filter(question -> question.getSession().getId() == sessionId)
                .orElseThrow(() -> new ApiException(ErrorCode.QUESTION_NOT_FOUND));
    }

    // API 명세 5.7의 400 조건 중 어노테이션으로 걸 수 없는 것
    private static void validate(InterviewSession session, AnswerRequest request) {
        if (session.isVideo() || request.inputType() != InputType.TEXT) {
            throw new FieldValidationException("inputType", "채팅 면접의 TEXT 답변만 낼 수 있습니다.");
        }
    }
}
