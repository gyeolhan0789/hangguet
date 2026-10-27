package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.AiJobType;
import java.util.List;
import java.util.Map;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI 작업 큐(AI 명세 1.3).
 *
 * <p>BE는 작업 종류에 맞는 큐에 LPUSH로 추가하고, 작업자는 처리 중 리스트({큐}:processing)로 옮겨 수신한다.
 *
 * <p>메시지 내용은 AiJobMessages가 생성한다.
 */
@Component
public class RedisAiJobQueue implements AiJobQueue {
    static final String KEY = "ai:jobs";
    // 사용자가 화면 앞에서 기다리는 질문 생성이 녹화 합치기 · 결과 생성 뒤에서 대기하지 않도록 별도 큐로 둔다
    static final String PLAN_KEY = "ai:jobs:plan";
    // ffmpeg로 오래 걸리는 녹화 합치기가 다른 작업을 지연시키지 않도록 별도 큐로 둔다
    static final String RECORDING_KEY = "ai:jobs:recording";

    /** 작업 큐 이름 전체. AiQueueMetrics가 큐별 길이를 이 목록으로 집계한다 */
    public static final List<String> KEYS = List.of(KEY, PLAN_KEY, RECORDING_KEY);

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final StringRedisTemplate redis;

    public RedisAiJobQueue(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void push(Map<String, Object> message) {
        redis.opsForList()
                .leftPush(keyOf(message.get("jobType")), JSON.writeValueAsString(message));
    }

    /** 작업 종류의 큐. 나머지 작업은 큐를 나누기 전부터 쓰던 ai:jobs에 추가한다 */
    static String keyOf(Object jobType) {
        if (AiJobType.PLAN.name().equals(jobType)) {
            return PLAN_KEY;
        }
        if (AiJobType.MERGE_RECORDING.name().equals(jobType)) {
            return RECORDING_KEY;
        }
        return KEY;
    }

    /** 큐의 처리 중 리스트. AI 작업자가 큐마다 별도로 사용한다 */
    public static String processingKeyOf(String key) {
        return key + ":processing";
    }
}
