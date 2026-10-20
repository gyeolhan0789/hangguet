package com.ssafy.a301.interview.stt;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.dto.InterviewDtos.SttTokenResponse;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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

    private final String apiKey;
    private final RestClient restClient;

    public SonioxClient(@Value("${soniox.api-key}") String apiKey) {
        this.apiKey = apiKey;
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

    public SttTokenResponse issueTemporaryKey(String clientReferenceId) {
        if (apiKey == null || apiKey.isBlank()) {
            LOG.warn("SONIOX_API_KEY가 없어 음성 인식 임시 키를 발급하지 못했습니다.");
            throw new ApiException(ErrorCode.STT_UNAVAILABLE);
        }
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
                                            clientReferenceId,
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
