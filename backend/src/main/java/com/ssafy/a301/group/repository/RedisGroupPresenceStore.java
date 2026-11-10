package com.ssafy.a301.group.repository;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * docs/그룹면접-설계.md 4.4의 group:{groupId}:presence Hash. 필드는 회원 id, 값은 마지막 대기실 조회 시각(epoch 밀리초). 쓸 때마다
 * TTL을 1시간으로 다시 잡는다.
 */
@Component
public class RedisGroupPresenceStore implements GroupPresenceStore {
    static final Duration TTL = Duration.ofHours(1);
    private final StringRedisTemplate redis;

    public RedisGroupPresenceStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void markSeen(long groupId, long userId, Instant now) {
        String key = key(groupId);
        redis.opsForHash().put(key, String.valueOf(userId), String.valueOf(now.toEpochMilli()));
        redis.expire(key, TTL);
    }

    // HSETNX. 그 사이 회원 자신이 남긴 더 새 시각을 덮어쓰지 않는다
    @Override
    public void recordIfAbsent(long groupId, long userId, Instant now) {
        String key = key(groupId);
        redis.opsForHash()
                .putIfAbsent(key, String.valueOf(userId), String.valueOf(now.toEpochMilli()));
        redis.expire(key, TTL);
    }

    @Override
    public Optional<Instant> lastSeen(long groupId, long userId) {
        Object value = redis.opsForHash().get(key(groupId), String.valueOf(userId));
        return Optional.ofNullable(value)
                .map(seen -> Instant.ofEpochMilli(Long.parseLong(seen.toString())));
    }

    @Override
    public void remove(long groupId, long userId) {
        redis.opsForHash().delete(key(groupId), String.valueOf(userId));
    }

    private static String key(long groupId) {
        return "group:" + groupId + ":presence";
    }
}
