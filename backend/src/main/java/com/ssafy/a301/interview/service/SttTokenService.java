package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.SttTokenResponse;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.stt.SonioxClient;
import org.springframework.stereotype.Service;

@Service
public class SttTokenService {

    private final InterviewSessionRepository sessions;
    private final SonioxClient soniox;

    public SttTokenService(InterviewSessionRepository sessions, SonioxClient soniox) {
        this.sessions = sessions;
        this.soniox = soniox;
    }

    public SttTokenResponse issue(long userId, long sessionId) {
        InterviewSession session =
                sessions.findByIdAndUserId(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.getStatus() != SessionStatus.IN_PROGRESS || !session.isVideo()) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        return soniox.issueTemporaryKey("session-" + sessionId);
    }
}
