package com.ssafy.a301.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.auth.oauth.OAuthProperties;
import com.ssafy.a301.auth.oauth.SocialProfile;
import com.ssafy.a301.user.domain.SocialProvider;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class RedisSocialSignupStoreTest {

    @Test
    @SuppressWarnings("unchecked")
    void profileIsKeptUnderHashedKeyUntilDeleted() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        var store =
                new RedisSocialSignupStore(
                        redis,
                        new OAuthProperties(Duration.ofMinutes(10), Duration.ofSeconds(5), null));
        var profile = new SocialProfile(SocialProvider.KAKAO, "12345", "k@kakao.com", "카카오");

        String token = store.issue(profile);

        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(values).set(key.capture(), json.capture(), eq(Duration.ofMinutes(10)));
        assertThat(key.getValue()).startsWith("social-signup:").doesNotContain(token);

        when(values.get(key.getValue())).thenReturn(json.getValue());
        assertThat(store.find(token)).isEqualTo(profile);
        store.delete(token);
        verify(redis).delete(key.getValue());
        when(values.get(anyString())).thenReturn(null);
        assertThat(store.find(token)).isNull();
    }
}
