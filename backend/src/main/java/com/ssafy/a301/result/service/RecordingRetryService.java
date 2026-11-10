package com.ssafy.a301.result.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.RecordingRepository;
import com.ssafy.a301.interview.service.AiJobService;
import com.ssafy.a301.result.dto.ResultDtos.RecordingRetryResponse;
import com.ssafy.a301.result.dto.ResultDtos.VideoStatus;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 6.5 녹화 다시 합치기. 원본 트랙은 지우지 않으므로 같은 원본으로 MERGE_RECORDING 작업을 다시 넣는다. 작업 메시지는 보낼 때 DB에서 만들므로(BE 설계
 * 5.0) 그룹 세션도 처음과 같은 rawPrefix · roomName · candidateIdentity · segments가 나간다(docs/그룹면접-설계.md
 * 6.12).
 */
@Service
public class RecordingRetryService {
    private final InterviewSessionRepository sessions;
    private final RecordingRepository recordings;
    private final AiJobService aiJobs;
    private final ResultService results;

    public RecordingRetryService(
            InterviewSessionRepository sessions,
            RecordingRepository recordings,
            AiJobService aiJobs,
            ResultService results) {
        this.sessions = sessions;
        this.recordings = recordings;
        this.aiJobs = aiJobs;
        this.results = results;
    }

    /**
     * 다시보기(6.4)가 FAILED인 화상 면접만 다시 합친다. 면접 행 → 녹화 행 순서로 잠가, 같은 면접의 요청이 겹치면 먼저 온 요청만 MERGING으로 바꾸고 뒤
     * 요청은 409 RECORDING_NOT_FAILED가 된다(작업은 하나만 들어간다).
     *
     * <p>없거나 남의 면접 404 SESSION_NOT_FOUND, 채팅 · 답변 없이 끝남 · FAILED가 아님 409 RECORDING_NOT_FAILED, 이미
     * 3번 다시 합침 409 RETRY_LIMIT_EXCEEDED
     */
    @Transactional
    public RecordingRetryResponse retry(long userId, long sessionId) {
        InterviewSession session =
                sessions.findForUpdate(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        // 답변 없이 끝난 면접은 합치기 작업을 넣지 않아 녹화 행이 없고, 다시보기도 없다(6.4 NO_RESULT)
        if (!session.isVideo() || session.getStatus() == SessionStatus.ABORTED) {
            throw new ApiException(ErrorCode.RECORDING_NOT_FAILED);
        }
        Recording recording =
                recordings
                        .findByObjectKeyForUpdate(Recording.sessionVideoKey(sessionId))
                        .orElse(null);
        OffsetDateTime now = OffsetDateTime.now();
        if (results.replayVideoStatus(session, recording, now) != VideoStatus.FAILED) {
            throw new ApiException(ErrorCode.RECORDING_NOT_FAILED);
        }
        if (recording != null && recording.getMergeRetryCount() >= Recording.MAX_MERGE_RETRIES) {
            throw new ApiException(ErrorCode.RETRY_LIMIT_EXCEEDED);
        }
        AiJob job = aiJobs.enqueue(AiJob.mergeRecording(sessionId));
        if (recording == null) {
            recordings.save(Recording.retryingSessionVideo(session, job.getId(), now));
        } else {
            recording.retryMerge(job.getId(), now);
        }
        return new RecordingRetryResponse(VideoStatus.MERGING);
    }
}
