package com.ssafy.a301.interview;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.InterviewDtos.TtsTokenResponse;
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
public class ElevenLabsClient {

    private static final Logger LOG = LoggerFactory.getLogger(ElevenLabsClient.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Duration TIMEOUT = Duration.ofSeconds(3);
    private static final Duration TOKEN_TTL = Duration.ofMinutes(15);
    private static final String MODEL_ID = "eleven_multilingual_v2";
    private static final String DEVIL_VOICE_ID = "DMyrgzQFny3JI1Y1paM5";

    private final RestClient restClient;

    public ElevenLabsClient() {
        JdkClientHttpRequestFactory requestFactory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(TIMEOUT).build());
        requestFactory.setReadTimeout(TIMEOUT);
        this.restClient =
                RestClient.builder()
                        .baseUrl("https://api.elevenlabs.io")
                        .requestFactory(requestFactory)
                        .build();
    }

    public TtsTokenResponse issueToken(String apiKey) {
        try {
            TokenResponse response =
                    restClient
                            .post()
                            .uri("/v1/single-use-token/tts_websocket")
                            .header("xi-api-key", apiKey)
                            .retrieve()
                            .body(TokenResponse.class);
            if (response == null || response.token() == null) {
                throw new RestClientException("ElevenLabs 응답에 token이 없습니다.");
            }
            return new TtsTokenResponse(
                    response.token(),
                    OffsetDateTime.now(KST).plus(TOKEN_TTL),
                    DEVIL_VOICE_ID,
                    MODEL_ID);
        } catch (RestClientException e) {
            LOG.warn("ElevenLabs 토큰 발급 실패: {}", e.getMessage());
            throw new ApiException(ErrorCode.TTS_UNAVAILABLE);
        }
    }

    record TokenResponse(String token) {}
}
