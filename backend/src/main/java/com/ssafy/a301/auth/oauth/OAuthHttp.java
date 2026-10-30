package com.ssafy.a301.auth.oauth;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.SocialProvider;
import java.net.http.HttpClient;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/** 제공자 서버 호출에 함께 쓰는 연결 설정과 오류 변환. 연결 설정은 카카오톡 연습 알림(KakaoMessageClient)도 쓴다 */
public final class OAuthHttp {
    private static final Logger LOG = LoggerFactory.getLogger(OAuthHttp.class);

    private OAuthHttp() {}

    public static RestClient restClient(OAuthProperties properties) {
        var factory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(properties.timeout()).build());
        factory.setReadTimeout(properties.timeout());
        return RestClient.builder().requestFactory(factory).build();
    }

    // 제공자가 4xx(잘못됐거나 이미 쓴 코드 · redirectUri 불일치)로 답하면 다시 로그인해야 하고, 그 밖의 실패는 잠시 뒤 다시 시도할 수 있다.
    // 401은 우리 앱 키(client id · secret)가 틀린 것이라 사용자가 다시 해도 소용없으므로 서버 문제로 본다
    static <T> T call(SocialProvider provider, Supplier<T> request) {
        try {
            return request.get();
        } catch (RestClientResponseException ex) {
            if (ex.getStatusCode().value() == HttpStatus.UNAUTHORIZED.value()) {
                LOG.error(
                        "{} 앱 키 오류 {}: {}",
                        provider,
                        ex.getStatusCode(),
                        ex.getResponseBodyAsString());
                throw new ApiException(ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
            }
            if (ex.getStatusCode().is4xxClientError()) {
                LOG.info(
                        "{} 로그인 거절 {}: {}",
                        provider,
                        ex.getStatusCode(),
                        ex.getResponseBodyAsString());
                throw new ApiException(ErrorCode.SOCIAL_LOGIN_FAILED);
            }
            LOG.warn("{} 서버 오류 {}", provider, ex.getStatusCode());
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
        } catch (RestClientException ex) {
            LOG.warn("{} 호출 실패: {}", provider, ex.getMessage());
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
        }
    }
}
