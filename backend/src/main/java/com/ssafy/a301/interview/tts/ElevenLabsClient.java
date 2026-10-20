package com.ssafy.a301.interview.tts;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.dto.InterviewDtos.TtsTokenResponse;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
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
    private static final Map<Persona, String> VOICE_IDS =
            Map.of(
                    Persona.DEVIL, "DMyrgzQFny3JI1Y1paM5",
                    Persona.COFFEE_CHAT, "21m00Tcm4TlvDq8ikWAM");

    private final String apiKey;
    private final RestClient restClient;

    public ElevenLabsClient(@Value("${elevenlabs.api-key}") String apiKey) {
        this.apiKey = apiKey;
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

    public TtsTokenResponse issueToken(Persona persona) {
        if (apiKey == null || apiKey.isBlank()) {
            LOG.warn("ELEVENLABS_API_KEY가 없어 질문 음성 토큰을 발급하지 못했습니다.");
            throw new ApiException(ErrorCode.TTS_UNAVAILABLE);
        }
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
                    VOICE_IDS.get(persona),
                    MODEL_ID);
        } catch (RestClientException e) {
            LOG.warn("ElevenLabs 토큰 발급 실패: {}", e.getMessage());
            throw new ApiException(ErrorCode.TTS_UNAVAILABLE);
        }
    }

    record TokenResponse(String token) {}
}
