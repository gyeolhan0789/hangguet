package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.TtsTokenResponse;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.tts.ElevenLabsClient;
import org.springframework.stereotype.Service;

@Service
public class TtsTokenService {

    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final ElevenLabsClient elevenLabs;

    public TtsTokenService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            ElevenLabsClient elevenLabs) {
        this.sessions = sessions;
        this.questions = questions;
        this.elevenLabs = elevenLabs;
    }

    public TtsTokenResponse issue(long userId, long sessionId, long questionId) {
        InterviewSession session =
                sessions.findByIdAndUserId(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (!questions.existsByIdAndSessionId(questionId, sessionId)) {
            throw new ApiException(ErrorCode.QUESTION_NOT_FOUND);
        }
        if (session.getStatus() != SessionStatus.IN_PROGRESS) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        return elevenLabs.issueToken(session.getPersona());
    }
}
