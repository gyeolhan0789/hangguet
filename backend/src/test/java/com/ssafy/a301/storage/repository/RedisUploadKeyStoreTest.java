package com.ssafy.a301.storage.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.storage.domain.UploadPurpose;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class RedisUploadKeyStoreTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);

    private final RedisUploadKeyStore store = new RedisUploadKeyStore(redis);

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(values);
    }

    @Test
    void issueStoresOwnerAndPurposeWithTtl() {
        store.issue("profile/7/a.png", 7L, UploadPurpose.PROFILE_IMAGE, Duration.ofMinutes(10));

        verify(values).set("upload:profile/7/a.png", "7:PROFILE_IMAGE", Duration.ofMinutes(10));
    }

    @Test
    void onlyOwnerWithSamePurposeMatches() {
        when(values.get("upload:profile/7/a.png")).thenReturn("7:PROFILE_IMAGE");

        assertThat(store.isIssuedTo("profile/7/a.png", 7L, UploadPurpose.PROFILE_IMAGE)).isTrue();
        assertThat(store.isIssuedTo("profile/7/a.png", 8L, UploadPurpose.PROFILE_IMAGE)).isFalse();
    }

    @Test
    void expiredOrUnknownKeyDoesNotMatch() {
        when(values.get("upload:profile/7/a.png")).thenReturn(null);

        assertThat(store.isIssuedTo("profile/7/a.png", 7L, UploadPurpose.PROFILE_IMAGE)).isFalse();
    }

    @Test
    void issueOnceStoresOnlyPurpose() {
        store.issueOnce("inquiry/a.png", UploadPurpose.INQUIRY_ATTACHMENT, Duration.ofHours(1));

        verify(values).set("upload:inquiry/a.png", "INQUIRY_ATTACHMENT", Duration.ofHours(1));
    }

    @Test
    void keyIssuedOnceIsUsedOnlyOnce() {
        when(values.get("upload:inquiry/a.png")).thenReturn("INQUIRY_ATTACHMENT");
        when(values.getAndDelete("upload:inquiry/a.png"))
                .thenReturn("INQUIRY_ATTACHMENT", (String) null);

        assertThat(store.isIssued("inquiry/a.png", UploadPurpose.INQUIRY_ATTACHMENT)).isTrue();
        assertThat(store.use("inquiry/a.png", UploadPurpose.INQUIRY_ATTACHMENT)).isTrue();
        assertThat(store.use("inquiry/a.png", UploadPurpose.INQUIRY_ATTACHMENT)).isFalse();
    }

    @Test
    void keyIssuedToMemberIsNotAOnceKey() {
        when(values.get("upload:profile/7/a.png")).thenReturn("7:PROFILE_IMAGE");

        assertThat(store.isIssued("profile/7/a.png", UploadPurpose.INQUIRY_ATTACHMENT)).isFalse();
    }
}
