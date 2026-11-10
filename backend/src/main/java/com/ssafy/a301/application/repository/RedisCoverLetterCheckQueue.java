package com.ssafy.a301.application.repository;

import com.ssafy.a301.common.time.KoreaTime;
import java.time.Duration;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 자기소개서 검증 전용 큐(AI 명세 2.1). ai:checks에 LPUSH하고, AI가 작업마다 넣는 ai:checks:result:{jobId}를 BRPOP으로 기다린다.
 * 지원서 저장 요청 안에서 답을 받아야 하므로 작업 큐(ai:jobs)·Outbox·결과 큐(ai:results)를 쓰지 않는다.
 */
@Component
public class RedisCoverLetterCheckQueue implements CoverLetterCheckQueue {
    static final String QUEUE_KEY = "ai:checks";
    static final String RESULT_KEY_PREFIX = "ai:checks:result:";
    // AI 명세 2.1(임시 값): AI의 Jev 대기(5초)에 큐를 오가는 여유를 더했다. AI도 이 시간이 지난 작업은 버린다
    static final Duration WAIT = Duration.ofSeconds(8);
    private static final Logger LOG = LoggerFactory.getLogger(RedisCoverLetterCheckQueue.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final StringRedisTemplate redis;

    public RedisCoverLetterCheckQueue(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public Verdict check(String companyName, String jobTitle, List<Item> coverLetterItems) {
        String jobId = UUID.randomUUID().toString();
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("jobId", jobId);
        message.put("requestedAt", KoreaTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
        message.put("companyName", companyName);
        message.put("jobTitle", jobTitle);
        message.put(
                "coverLetterItems",
                coverLetterItems.stream()
                        .map(item -> Map.of("question", item.question(), "answer", item.answer()))
                        .toList());
        try {
            redis.opsForList().leftPush(QUEUE_KEY, JSON.writeValueAsString(message));
            String result = redis.opsForList().rightPop(RESULT_KEY_PREFIX + jobId, WAIT);
            if (result == null) {
                LOG.warn("자기소개서 검증 결과를 기다리다 시간이 지났다 jobId={}", jobId);
                return Verdict.UNAVAILABLE;
            }
            return verdict(JSON.readTree(result));
        } catch (DataAccessException | JacksonException ex) {
            LOG.warn("자기소개서 검증을 요청하지 못했다 jobId={}", jobId, ex);
            return Verdict.UNAVAILABLE;
        }
    }

    // 결과에는 쓸 수 있는지(usable, 참·거짓)가 오거나, 검증에 실패하면 error 값 CHECK_FAILED가 온다
    static Verdict verdict(JsonNode result) {
        JsonNode usable = result.get("usable");
        if (usable == null || !usable.isBoolean()) {
            return Verdict.UNAVAILABLE;
        }
        return usable.booleanValue() ? Verdict.USABLE : Verdict.UNUSABLE;
    }
}
