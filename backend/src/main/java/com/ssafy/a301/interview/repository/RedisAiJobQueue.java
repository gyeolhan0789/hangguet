package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.AiJob;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * BE 설계 7장의 ai:jobs 리스트. BE는 LPUSH로 넣고, AI 분석 작업자는 BLMOVE로 처리 중 리스트(ai:jobs:processing)에 옮겨 꺼낸다.
 * 메시지는 AI 명세 1.3 형식이며 answerId는 SCORE_ANSWER에만 넣는다.
 */
@Component
public class RedisAiJobQueue implements AiJobQueue {
    static final String KEY = "ai:jobs";
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final StringRedisTemplate redis;

    public RedisAiJobQueue(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void push(AiJob job) {
        redis.opsForList().leftPush(KEY, message(job));
    }

    static String message(AiJob job) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("jobType", job.getJobType().name());
        message.put("jobId", job.getId().toString());
        message.put("sessionId", job.getSessionId());
        if (job.getAnswerId() != null) {
            message.put("answerId", job.getAnswerId());
        }
        return JSON.writeValueAsString(message);
    }
}
