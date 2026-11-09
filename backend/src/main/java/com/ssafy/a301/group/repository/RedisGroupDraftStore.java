package com.ssafy.a301.group.repository;

import java.time.Duration;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** docs/그룹면접-설계.md 4.4의 group-draft:{sessionId}:{questionId}. 값은 작성 중인 글이고, 지우지 못해도 1시간 뒤 사라진다. */
@Component
public class RedisGroupDraftStore implements GroupDraftStore {
    static final Duration TTL = Duration.ofHours(1);
    private final StringRedisTemplate redis;

    public RedisGroupDraftStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void save(long sessionId, long questionId, String content) {
        redis.opsForValue().set(key(sessionId, questionId), content, TTL);
    }

    @Override
    public Optional<String> find(long sessionId, long questionId) {
        return Optional.ofNullable(redis.opsForValue().get(key(sessionId, questionId)));
    }

    @Override
    public void delete(long sessionId, long questionId) {
        redis.delete(key(sessionId, questionId));
    }

    private static String key(long sessionId, long questionId) {
        return "group-draft:" + sessionId + ":" + questionId;
    }
}
