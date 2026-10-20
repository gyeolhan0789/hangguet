package com.ssafy.a301.interview;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.InterviewDtos.SttTokenResponse;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class SonioxClient {

    private static final Logger LOG = LoggerFactory.getLogger(SonioxClient.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final Duration TOKEN_TTL = Duration.ofMinutes(5);

    private final RestClient restClient;

    public SonioxClient() {
        JdkClientHttpRequestFactory requestFactory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(TIMEOUT).build());
        requestFactory.setReadTimeout(TIMEOUT);
        this.restClient =
                RestClient.builder()
                        .baseUrl("https://api.soniox.com")
                        .requestFactory(requestFactory)
                        .build();
    }

    public SttTokenResponse issueTemporaryKey(String apiKey, long sessionId) {
        try {
            KeyResponse response =
                    restClient
                            .post()
                            .uri("/v1/auth/temporary-api-key")
                            .header("Authorization", "Bearer " + apiKey)
                            .body(
                                    new KeyRequest(
                                            "transcribe_websocket",
                                            TOKEN_TTL.toSeconds(),
                                            "mock-session-" + sessionId,
                                            true))
                            .retrieve()
                            .body(KeyResponse.class);
            if (response == null || response.apiKey() == null || response.expiresAt() == null) {
                throw new RestClientException("Soniox 응답에 api_key 또는 expires_at이 없습니다.");
            }
            return new SttTokenResponse(
                    response.apiKey(),
                    response.expiresAt().atZoneSameInstant(KST).toOffsetDateTime());
        } catch (RestClientException e) {
            LOG.warn("Soniox 임시 키 발급 실패: {}", e.getMessage());
            throw new ApiException(ErrorCode.STT_UNAVAILABLE);
        }
    }

    record KeyRequest(
            @JsonProperty("usage_type") String usageType,
            @JsonProperty("expires_in_seconds") long expiresInSeconds,
            @JsonProperty("client_reference_id") String clientReferenceId,
            @JsonProperty("single_use") boolean singleUse) {}

    record KeyResponse(
            @JsonProperty("api_key") String apiKey,
            @JsonProperty("expires_at") OffsetDateTime expiresAt) {}
}
