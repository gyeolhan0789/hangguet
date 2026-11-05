package com.ssafy.a301.group.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

class RedisGroupPresenceStoreTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final HashOperations<String, Object, Object> hashes = mock(HashOperations.class);

    private final RedisGroupPresenceStore store = new RedisGroupPresenceStore(redis);

    @BeforeEach
    void setUp() {
        when(redis.<Object, Object>opsForHash()).thenReturn(hashes);
    }

    @Test
    void recordStoresEpochMillisPerUserAndRefreshesTtl() {
        store.record(7L, 3L, Instant.ofEpochMilli(1_000L));

        verify(hashes).put("group:7:presence", "3", "1000");
        verify(redis).expire("group:7:presence", RedisGroupPresenceStore.TTL);
    }

    @Test
    void recordIfAbsentKeepsNewerTime() {
        store.recordIfAbsent(7L, 3L, Instant.ofEpochMilli(1_000L));

        verify(hashes).putIfAbsent("group:7:presence", "3", "1000");
        verify(redis).expire("group:7:presence", RedisGroupPresenceStore.TTL);
    }

    @Test
    void lastSeenReadsStoredTime() {
        when(hashes.get("group:7:presence", "3")).thenReturn("1000");

        assertThat(store.lastSeen(7L, 3L)).contains(Instant.ofEpochMilli(1_000L));
        assertThat(store.lastSeen(7L, 4L)).isEmpty();
    }

    @Test
    void removeDeletesUserField() {
        store.remove(7L, 3L);

        verify(hashes).delete("group:7:presence", "3");
    }
}
