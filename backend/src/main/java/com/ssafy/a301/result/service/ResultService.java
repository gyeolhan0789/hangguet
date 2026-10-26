package com.ssafy.a301.result.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.RecordingRepository;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import com.ssafy.a301.interview.repository.SpeechMetricRepository;
import com.ssafy.a301.result.dto.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.dto.ResultDtos.ResultResponse;
import com.ssafy.a301.result.mapper.ResultMapper;
import com.ssafy.a301.result.mapper.ResultMapper.QuestionAndAnswer;
import com.ssafy.a301.storage.s3.S3FileStorage;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 6.3 면접 결과·6.4 다시보기. 저장된 결과(BE 설계 5.5)를 읽기만 하고, 응답 변환과 3단계(grade) 계산은 ResultMapper가 한다. 결과가 나온
 * (COMPLETED) 면접만 준다.
 */
@Service
public class ResultService {
    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final SessionScoreRepository scores;
    private final SpeechMetricRepository speechMetrics;
    private final RecordingRepository recordings;
    private final S3FileStorage storage;

    public ResultService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            SessionScoreRepository scores,
            SpeechMetricRepository speechMetrics,
            RecordingRepository recordings,
            S3FileStorage storage) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.scores = scores;
        this.speechMetrics = speechMetrics;
        this.recordings = recordings;
        this.storage = storage;
    }

    /** 6.3. 기준 4개, 답변한 질문의 피드백, 말하기 지표(채팅이면 null) */
    @Transactional(readOnly = true)
    public ResultResponse result(long userId, long sessionId) {
        InterviewSession session = completedSession(userId, sessionId);
        List<SessionScore> sessionScores =
                scores.findBySessionIds(List.of(sessionId)).stream()
                        .sorted(Comparator.comparing(SessionScore::getCriterion))
                        .toList();
        // 완료 결과는 기준 4개가 있어야 한다. 불완전한 결과를 정상 평가로 보여 주지 않는다(5.13과 같음).
        if (!Criterion.coversAllOnce(
                sessionScores.stream().map(SessionScore::getCriterion).toList())) {
            throw new ApiException(ErrorCode.INTERNAL_ERROR);
        }
        List<QuestionAndAnswer> answered =
                answers.findWithQuestionBySessionId(sessionId).stream()
                        .map(answer -> new QuestionAndAnswer(answer.getQuestion(), answer))
                        .toList();
        return ResultMapper.toResult(
                session,
                sessionScores,
                answered,
                session.isVideo() ? speechMetrics.findById(sessionId).orElse(null) : null);
    }

    /**
     * 6.4. 낸 질문은 답변이 없어도 넣는다. 화상은 합친 녹화(recording.merged로 저장한 SESSION_VIDEO)가 있을 때만 주소를 주고, 합치기
     * 전이거나 실패했으면 videoUrl이 null이다(B-19 결정 전 임시 동작).
     */
    @Transactional(readOnly = true)
    public ReplayResponse replay(long userId, long sessionId) {
        InterviewSession session = completedSession(userId, sessionId);
        Map<Long, Answer> answerByQuestion =
                answers.findWithQuestionBySessionId(sessionId).stream()
                        .collect(
                                Collectors.toMap(
                                        a -> a.getQuestion().getId(), Function.identity()));
        List<QuestionAndAnswer> items =
                questions.findBySessionIdOrderBySeq(sessionId).stream()
                        .map(q -> new QuestionAndAnswer(q, answerByQuestion.get(q.getId())))
                        .toList();
        return ResultMapper.toReplay(session, items, videoUrl(session));
    }

    private String videoUrl(InterviewSession session) {
        if (!session.isVideo()) {
            return null;
        }
        String key = Recording.sessionVideoKey(session.getId());
        return recordings.existsByObjectKey(key) ? storage.presignDownload(key) : null;
    }

    /** 없거나 남의 면접 404, 결과 생성 중·실패(또는 아직 안 끝남) 409 RESULT_NOT_READY, 답변 없이 끝남 409 NO_RESULT */
    private InterviewSession completedSession(long userId, long sessionId) {
        InterviewSession session =
                sessions.findWithApplication(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.getStatus() == SessionStatus.ABORTED) {
            throw new ApiException(ErrorCode.NO_RESULT);
        }
        if (session.getStatus() != SessionStatus.COMPLETED) {
            throw new ApiException(ErrorCode.RESULT_NOT_READY);
        }
        return session;
    }
}
