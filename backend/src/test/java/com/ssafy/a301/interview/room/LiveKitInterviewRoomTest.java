package com.ssafy.a301.interview.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import livekit.LivekitAgentDispatch.CreateAgentDispatchRequest;
import livekit.LivekitRoom.CreateRoomRequest;
import livekit.LivekitRoom.DeleteRoomRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 가짜 LiveKit 서버 API(HTTP)로 입장 토큰 권한, 방 만들기(녹화 설정)·에이전트 배정·방 지우기 요청을 확인한다. */
class LiveKitInterviewRoomTest {
    private static final String SECRET = "test-secret-at-least-32-bytes-long-000";

    private final Map<String, byte[]> requests = new ConcurrentHashMap<>();
    private final Map<String, Integer> statuses = new ConcurrentHashMap<>();
    private HttpServer server;
    private String apiUrl;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/twirp/",
                exchange -> {
                    String path = exchange.getRequestURI().getPath();
                    requests.put(path, exchange.getRequestBody().readAllBytes());
                    exchange.getResponseHeaders().add("Content-Type", "application/protobuf");
                    exchange.sendResponseHeaders(statuses.getOrDefault(path, 200), -1);
                    exchange.close();
                });
        server.start();
        apiUrl = "ws://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void videoTokenCanPublishCameraAndMicrophoneInItsRoomOnly() {
        RoomResponse access = room(apiUrl).issueAccess(55L, true);

        assertThat(access.url()).isEqualTo("wss://rtc.test");
        assertThat(access.expiresAt())
                .isBetween(
                        OffsetDateTime.now().plusMinutes(9), OffsetDateTime.now().plusMinutes(11));
        JsonNode claims = claims(access.token());
        assertThat(claims.path("sub").asString()).isEqualTo("candidate");
        JsonNode video = claims.path("video");
        assertThat(video.path("room").asString()).isEqualTo("interview-55");
        assertThat(video.path("roomJoin").asBoolean()).isTrue();
        assertThat(video.path("canPublish").asBoolean()).isTrue();
        assertThat(video.path("canSubscribe").asBoolean()).isTrue();
        assertThat(video.path("canPublishData").asBoolean()).isTrue();
        assertThat(video.path("canPublishSources").values())
                .extracting(JsonNode::asString)
                .containsExactly("camera", "microphone");
        assertThat(video.path("roomCreate").asBoolean()).isFalse();
        // 토큰 자체의 만료도 10분이다
        assertThat(claims.path("exp").asLong() - Instant.now().getEpochSecond())
                .isBetween(590L, 600L);
    }

    @Test
    void chatTokenOnlyReceivesAndSendsMessages() {
        JsonNode video = claims(room(apiUrl).issueAccess(55L, false).token()).path("video");

        assertThat(video.path("canPublish").asBoolean()).isFalse();
        assertThat(video.path("canPublishData").asBoolean()).isTrue();
        assertThat(video.path("canSubscribe").asBoolean()).isTrue();
    }

    @Test
    void openCreatesRecordedRoomAndDispatchesAgent() throws Exception {
        room(apiUrl).open(55L, true, Map.of("sessionId", 55, "currentSeq", 1));

        CreateRoomRequest created =
                CreateRoomRequest.parseFrom(requests.get("/twirp/livekit.RoomService/CreateRoom"));
        assertThat(created.getName()).isEqualTo("interview-55");
        assertThat(created.getEgress().getTracks().getFilepath())
                .isEqualTo("recordings/raw/55/{publisher_identity}-{track_type}");
        assertThat(created.getEgress().getTracks().getS3().getBucket()).isEqualTo("bucket");
        CreateAgentDispatchRequest dispatch =
                CreateAgentDispatchRequest.parseFrom(
                        requests.get("/twirp/livekit.AgentDispatchService/CreateDispatch"));
        assertThat(dispatch.getRoom()).isEqualTo("interview-55");
        assertThat(dispatch.getAgentName()).isEqualTo("a301-interviewer");
        assertThat(
                        JsonMapper.builder()
                                .build()
                                .readTree(dispatch.getMetadata())
                                .path("currentSeq")
                                .asInt())
                .isEqualTo(1);
    }

    @Test
    void chatRoomIsNotRecorded() throws Exception {
        room(apiUrl).open(55L, false, Map.of());

        assertThat(
                        CreateRoomRequest.parseFrom(
                                        requests.get("/twirp/livekit.RoomService/CreateRoom"))
                                .hasEgress())
                .isFalse();
    }

    @Test
    void failedDispatchDeletesRoomAndIsUnavailable() throws Exception {
        statuses.put("/twirp/livekit.AgentDispatchService/CreateDispatch", 500);

        assertThatThrownBy(() -> room(apiUrl).open(55L, true, Map.of()))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.ROOM_UNAVAILABLE));
        assertThat(
                        DeleteRoomRequest.parseFrom(
                                        requests.get("/twirp/livekit.RoomService/DeleteRoom"))
                                .getRoom())
                .isEqualTo("interview-55");
    }

    @Test
    void closeIgnoresFailures() {
        statuses.put("/twirp/livekit.RoomService/DeleteRoom", 500);
        room(apiUrl).close(55L);

        server.stop(0);
        room(apiUrl).close(55L);
    }

    @Test
    void missingSettingsMakeRoomUnavailable() {
        LiveKitInterviewRoom unset =
                new LiveKitInterviewRoom(
                        "",
                        "",
                        "",
                        "",
                        "a301-interviewer",
                        Duration.ofMinutes(10),
                        "",
                        "",
                        "b",
                        "r");

        assertThatThrownBy(() -> unset.issueAccess(55L, true)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> unset.open(55L, true, Map.of())).isInstanceOf(ApiException.class);
        unset.close(55L);
    }

    @Test
    void browserGetsPublicUrlWhenServerUrlDiffers() throws IOException {
        // 운영처럼 서버 주소(내부)와 브라우저 주소(공개)가 다를 때. 개발 서버는 두 값이 같아 드러나지 않는다
        StandardEnvironment env = new StandardEnvironment();
        MutablePropertySources sources = env.getPropertySources();
        sources.replace(
                StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                new SystemEnvironmentPropertySource(
                        StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME,
                        Map.of(
                                "LIVEKIT_URL", "ws://a301-prod-livekit:7880",
                                "LIVEKIT_PUBLIC_URL", "wss://rtc.hangguet.co.kr")));
        new YamlPropertySourceLoader()
                .load("application.yml", new ClassPathResource("application.yml"))
                .forEach(sources::addLast);

        assertThat(env.resolveRequiredPlaceholders(LiveKitInterviewRoom.URL_PROPERTY))
                .isEqualTo("wss://rtc.hangguet.co.kr");
        assertThat(env.resolveRequiredPlaceholders(LiveKitInterviewRoom.API_URL_PROPERTY))
                .isEqualTo("ws://a301-prod-livekit:7880");
    }

    @Test
    void apiUrlAcceptsWebSocketAddress() {
        assertThat(LiveKitInterviewRoom.httpUrl("wss://rtc.test")).isEqualTo("https://rtc.test/");
        assertThat(LiveKitInterviewRoom.httpUrl("ws://livekit:7880/"))
                .isEqualTo("http://livekit:7880/");
        assertThat(LiveKitInterviewRoom.httpUrl("https://x.livekit.cloud"))
                .isEqualTo("https://x.livekit.cloud/");
    }

    private static LiveKitInterviewRoom room(String apiUrl) {
        return new LiveKitInterviewRoom(
                "wss://rtc.test",
                apiUrl,
                "key",
                SECRET,
                "a301-interviewer",
                Duration.ofMinutes(10),
                "access",
                "secret",
                "bucket",
                "ap-northeast-2");
    }

    private static JsonNode claims(String token) {
        String payload = token.split("\\.")[1];
        return JsonMapper.builder()
                .build()
                .readTree(
                        new String(Base64.getUrlDecoder().decode(payload), StandardCharsets.UTF_8));
    }
}
