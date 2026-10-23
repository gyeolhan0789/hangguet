package com.ssafy.a301.interview.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Outbox 작업을 AI 작업 메시지로 만든다(AI 명세 1.3·2~4장). AI는 DB를 읽지 않으므로 작업에 필요한 내용을 모두 담는다. 트랜잭션 안에서 부른다(지연
 * 로딩). 답변 음성 위치는 API 명세 B-19가 정해지면 더한다.
 */
@Component
public class AiJobMessages {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final InterviewSessionRepository sessions;
    private final InterviewPlanRepository plans;
    private final AnswerRepository answers;

    public AiJobMessages(
            InterviewSessionRepository sessions,
            InterviewPlanRepository plans,
            AnswerRepository answers) {
        this.sessions = sessions;
        this.plans = plans;
        this.answers = answers;
    }

    /** 작업에 쓸 면접·플랜·답변이 없으면 IllegalStateException(보낼 수 없는 작업) */
    public Map<String, Object> of(AiJob job) {
        InterviewSession session =
                sessions.findById(job.getSessionId()).orElseThrow(() -> missing(job, "면접"));
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("jobType", job.getJobType().name());
        message.put("jobId", job.getId().toString());
        message.put("sessionId", job.getSessionId());
        // Outbox에 넣은 시각. AI도 최대 대기 시간을 여기부터 센다(AI 명세 1.3·5장)
        message.put(
                "requestedAt",
                job.getCreatedAt()
                        .atZoneSameInstant(KST)
                        .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
        switch (job.getJobType()) {
            case PLAN -> putPlan(message, session.getApplication());
            case SCORE_ANSWER -> putScoreAnswer(message, job, session);
            case EVALUATE -> putEvaluate(message, job, session);
            case MERGE_RECORDING -> putMergeRecording(message, session);
            default -> throw new IllegalStateException("메시지를 만들 수 없는 작업 종류: " + job.getJobType());
        }
        return message;
    }

    // AI 명세 2장
    private static void putPlan(Map<String, Object> message, Application application) {
        message.put("companyName", application.getCompanyName());
        message.put("jobTitle", application.getJobTitle());
        message.put("coverLetter", application.getCoverLetter());
    }

    // AI 명세 3장
    private void putScoreAnswer(Map<String, Object> message, AiJob job, InterviewSession session) {
        Answer answer = answers.findById(job.getAnswerId()).orElseThrow(() -> missing(job, "답변"));
        InterviewPlan plan = plan(job);
        message.put("answerId", answer.getId());
        message.put("mode", session.getMode().name());
        message.putAll(answerContent(answer, plan));
    }

    // AI 명세 4장. 답이 없는 질문은 넣지 않는다
    private void putEvaluate(Map<String, Object> message, AiJob job, InterviewSession session) {
        InterviewPlan plan = plan(job);
        message.put("mode", session.getMode().name());
        message.put("coverLetter", session.getApplication().getCoverLetter());
        message.put("claims", plan.getClaims());
        List<Map<String, Object>> answered =
                answers.findWithQuestionBySessionId(session.getId()).stream()
                        .map(
                                answer -> {
                                    Map<String, Object> item = new LinkedHashMap<>();
                                    item.put("answerId", answer.getId());
                                    item.putAll(answerContent(answer, plan));
                                    item.put("evaluation", answer.getEvaluation());
                                    return item;
                                })
                        .toList();
        message.put("answers", answered);
    }

    // AI 명세 7장. 위치는 면접마다 정해져 있다
    private static void putMergeRecording(Map<String, Object> message, InterviewSession session) {
        if (!session.isVideo()) {
            throw new IllegalStateException("화상 면접이 아니라 녹화가 없다: " + session.getId());
        }
        message.put("rawPrefix", Recording.rawPrefix(session.getId()));
        message.put("objectKey", Recording.sessionVideoKey(session.getId()));
    }

    // seq·question·criteria·content와 화상이면 tokens·speech
    private static Map<String, Object> answerContent(Answer answer, InterviewPlan plan) {
        InterviewQuestion question = answer.getQuestion();
        Map<String, Object> content = new LinkedHashMap<>();
        content.put("seq", question.getSeq());
        content.put("question", question.getContent());
        content.put(
                "criteria",
                plan.question(question.getSeq()).map(PlanQuestion::criteria).orElse(null));
        content.put("content", answer.getContent());
        if (answer.getTokens() != null) {
            content.put("tokens", answer.getTokens());
        }
        if (answer.getSpeech() != null) {
            content.put("speech", answer.getSpeech());
        }
        return content;
    }

    private InterviewPlan plan(AiJob job) {
        return plans.findById(job.getSessionId()).orElseThrow(() -> missing(job, "플랜"));
    }

    private static IllegalStateException missing(AiJob job, String what) {
        return new IllegalStateException(what + "이 없어 AI 작업을 보낼 수 없다: " + job.getId());
    }
}
