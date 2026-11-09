package com.ssafy.a301.group.repository;

import java.time.Duration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** docs/그룹면접-설계.md 4.4의 livekit-webhook:{eventId}. 값은 1, TTL 1시간 */
@Component
public class RedisWebhookEventStore implements WebhookEventStore {
    static final Duration TTL = Duration.ofHours(1);
    private final StringRedisTemplate redis;

    public RedisWebhookEventStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public boolean markNew(String eventId) {
        return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key(eventId), "1", TTL));
    }

    @Override
    public void forget(String eventId) {
        redis.delete(key(eventId));
    }

    private static String key(String eventId) {
        return "livekit-webhook:" + eventId;
    }
}
