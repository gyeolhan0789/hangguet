package com.ssafy.a301.interview.repository;

import java.util.Map;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * BE 설계 7장의 ai:jobs 리스트. BE는 LPUSH로 넣고, AI 분석 작업자는 BLMOVE로 처리 중 리스트(ai:jobs:processing)에 옮겨 꺼낸다.
 * 메시지 내용은 AiJobMessages가 만든다.
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
    public void push(Map<String, Object> message) {
        redis.opsForList().leftPush(KEY, JSON.writeValueAsString(message));
    }
}
