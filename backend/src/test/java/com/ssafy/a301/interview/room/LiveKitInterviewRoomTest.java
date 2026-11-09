package com.ssafy.a301.interview.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.room.InterviewRoom.Presence;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import livekit.LivekitAgentDispatch.CreateAgentDispatchRequest;
import livekit.LivekitEgress.EgressInfo;
import livekit.LivekitEgress.EgressStatus;
import livekit.LivekitEgress.ListEgressRequest;
import livekit.LivekitEgress.ListEgressResponse;
import livekit.LivekitEgress.TrackEgressRequest;
import livekit.LivekitModels.DataPacket;
import livekit.LivekitModels.ParticipantInfo;
import livekit.LivekitModels.TrackInfo;
import livekit.LivekitModels.TrackType;
import livekit.LivekitRoom.CreateRoomRequest;
import livekit.LivekitRoom.DeleteRoomRequest;
import livekit.LivekitRoom.ListParticipantsRequest;
import livekit.LivekitRoom.ListParticipantsResponse;
import livekit.LivekitRoom.RoomParticipantIdentity;
import livekit.LivekitRoom.SendDataRequest;
import livekit.LivekitRoom.UpdateRoomMetadataRequest;
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

/** 가짜 LiveKit 서버 API(HTTP)로 입장 토큰 권한, 방 만들기(녹화 설정)·에이전트 배정·방 지우기·참가자 조회 요청을 확인한다. */
class LiveKitInterviewRoomTest {
    private static final String SECRET = "test-secret-at-least-32-bytes-long-000";
    private static final String LIST_PARTICIPANTS = "/twirp/livekit.RoomService/ListParticipants";
    private static final String LIST_EGRESS = "/twirp/livekit.Egress/ListEgress";
    private static final String START_TRACK_EGRESS = "/twirp/livekit.Egress/StartTrackEgress";

    private final Map<String, byte[]> requests = new ConcurrentHashMap<>();
    private final Map<String, Integer> statuses = new ConcurrentHashMap<>();
    private final Map<String, byte[]> bodies = new ConcurrentHashMap<>();
    private final Map<String, String> authorizations = new ConcurrentHashMap<>();
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
                    authorizations.put(
                            path, exchange.getRequestHeaders().getFirst("Authorization"));
                    exchange.getResponseHeaders().add("Content-Type", "application/protobuf");
                    byte[] body = bodies.get(path);
                    exchange.sendResponseHeaders(
                            statuses.getOrDefault(path, 200), body == null ? -1 : body.length);
                    if (body != null) {
                        exchange.getResponseBody().write(body);
                    }
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

    // 기준: API 명세 10.10 5.14 · 10.11, AI 명세 6.7, docs/그룹면접-설계.md 6.12
    @Test
    void groupTokenUsesGroupRoomAndSessionIdentity() {
        JsonNode claims = claims(room(apiUrl).issueGroupAccess(7L, 55L, true).token());

        assertThat(claims.path("sub").asString()).isEqualTo("candidate-55");
        assertThat(claims.path("video").path("room").asString()).isEqualTo("group-7");
        assertThat(claims.path("video").path("canPublish").asBoolean()).isTrue();
    }

    @Test
    void openGroupCreatesRoomWithMetadataAndGroupRecordingPath() throws Exception {
        room(apiUrl).openGroup(7L, true, Map.of("kind", "GROUP"), "{\"turnVersion\":1}");

        CreateRoomRequest created =
                CreateRoomRequest.parseFrom(requests.get("/twirp/livekit.RoomService/CreateRoom"));
        assertThat(created.getName()).isEqualTo("group-7");
        assertThat(created.getMetadata()).isEqualTo("{\"turnVersion\":1}");
        assertThat(created.getEgress().getTracks().getFilepath())
                .isEqualTo("recordings/raw/group-7/{publisher_identity}-{track_type}");
        CreateAgentDispatchRequest dispatch =
                CreateAgentDispatchRequest.parseFrom(
                        requests.get("/twirp/livekit.AgentDispatchService/CreateDispatch"));
        assertThat(dispatch.getRoom()).isEqualTo("group-7");
        assertThat(
                        JsonMapper.builder()
                                .build()
                                .readTree(dispatch.getMetadata())
                                .path("kind")
                                .asString())
                .isEqualTo("GROUP");
    }

    @Test
    void failedGroupDispatchDeletesGroupRoom() throws Exception {
        statuses.put("/twirp/livekit.AgentDispatchService/CreateDispatch", 500);

        assertThatThrownBy(() -> room(apiUrl).openGroup(7L, false, Map.of(), "{}"))
                .isInstanceOf(ApiException.class);
        assertThat(
                        DeleteRoomRequest.parseFrom(
                                        requests.get("/twirp/livekit.RoomService/DeleteRoom"))
                                .getRoom())
                .isEqualTo("group-7");
    }

    // 기준: AI 명세 6.5(면접관 interviewer 여부와 지원자 candidate 입장 시각을 ListParticipants로 본다)
    @Test
    void presenceReadsInterviewerAndCandidateJoinTimeWithRoomAdminGrant() throws Exception {
        bodies.put(
                LIST_PARTICIPANTS,
                ListParticipantsResponse.newBuilder()
                        .addParticipants(ParticipantInfo.newBuilder().setIdentity("interviewer"))
                        .addParticipants(
                                ParticipantInfo.newBuilder()
                                        .setIdentity("candidate")
                                        .setJoinedAt(1_762_322_400L)
                                        .setJoinedAtMs(1_762_322_400_250L))
                        .build()
                        .toByteArray());

        Presence presence = room(apiUrl).presence(55L);

        assertThat(presence.interviewer()).isTrue();
        assertThat(presence.candidateJoinedAt().toInstant())
                .isEqualTo(Instant.ofEpochMilli(1_762_322_400_250L));
        assertThat(ListParticipantsRequest.parseFrom(requests.get(LIST_PARTICIPANTS)).getRoom())
                .isEqualTo("interview-55");
        JsonNode video =
                claims(authorizations.get(LIST_PARTICIPANTS).replaceFirst("^Bearer ", ""))
                        .path("video");
        assertThat(video.path("roomAdmin").asBoolean()).isTrue();
        assertThat(video.path("room").asString()).isEqualTo("interview-55");
    }

    @Test
    void presenceUsesSecondsWhenServerHasNoMillisecondJoinTime() {
        bodies.put(
                LIST_PARTICIPANTS,
                ListParticipantsResponse.newBuilder()
                        .addParticipants(
                                ParticipantInfo.newBuilder()
                                        .setIdentity("candidate")
                                        .setJoinedAt(1_762_322_400L))
                        .build()
                        .toByteArray());

        Presence presence = room(apiUrl).presence(55L);

        assertThat(presence.interviewer()).isFalse();
        assertThat(presence.candidateJoinedAt().toInstant())
                .isEqualTo(Instant.ofEpochSecond(1_762_322_400L));
    }

    @Test
    void emptyRoomHasNobodyAndFailedLookupThrows() {
        assertThat(room(apiUrl).presence(55L)).isEqualTo(new Presence(false, null));

        statuses.put(LIST_PARTICIPANTS, 500);
        assertThatThrownBy(() -> room(apiUrl).presence(55L))
                .isInstanceOf(UncheckedIOException.class);
    }

    // 기준: BE 파트 요청 2(녹화가 진행 중이 아닌 트랙만 같은 S3 설정 · 파일 이름 규칙으로 다시 요청한다)
    @Test
    void ensureTrackRecordingRestartsOnlyTracksWithoutRunningEgress() throws Exception {
        bodies.put(
                LIST_PARTICIPANTS,
                participants(
                        participant(
                                "candidate",
                                track("TR_CV", TrackType.VIDEO),
                                track("TR_CA", TrackType.AUDIO)),
                        participant("interviewer", track("TR_IA", TrackType.AUDIO))));
        bodies.put(
                LIST_EGRESS,
                egresses(
                        egress("TR_CV", EgressStatus.EGRESS_ACTIVE),
                        egress("TR_IA", EgressStatus.EGRESS_STARTING),
                        egress("TR_CA", EgressStatus.EGRESS_FAILED)));

        room(apiUrl).ensureTrackRecording(55L);

        ListEgressRequest list = ListEgressRequest.parseFrom(requests.get(LIST_EGRESS));
        assertThat(list.getRoomName()).isEqualTo("interview-55");
        assertThat(list.getActive()).isTrue();
        TrackEgressRequest restart = TrackEgressRequest.parseFrom(requests.get(START_TRACK_EGRESS));
        assertThat(restart.getRoomName()).isEqualTo("interview-55");
        assertThat(restart.getTrackId()).isEqualTo("TR_CA");
        assertThat(restart.getFile().getFilepath())
                .isEqualTo("recordings/raw/55/candidate-audio-TR_CA-retry");
        assertThat(restart.getFile().getDisableManifest()).isTrue();
        assertThat(restart.getFile().getS3().getBucket()).isEqualTo("bucket");
        JsonNode video =
                claims(authorizations.get(START_TRACK_EGRESS).replaceFirst("^Bearer ", ""))
                        .path("video");
        assertThat(video.path("roomRecord").asBoolean()).isTrue();
    }

    @Test
    void ensureTrackRecordingLeavesRecordingAndUnpublishedTracks() {
        // 지원자 음성 · 면접관은 트랙이 없어 녹화할 수 없다(경고 로그만 남긴다)
        bodies.put(
                LIST_PARTICIPANTS,
                participants(participant("candidate", track("TR_CV", TrackType.VIDEO))));
        bodies.put(LIST_EGRESS, egresses(egress("TR_CV", EgressStatus.EGRESS_ACTIVE)));

        room(apiUrl).ensureTrackRecording(55L);

        assertThat(requests).containsKey(LIST_EGRESS).doesNotContainKey(START_TRACK_EGRESS);
    }

    @Test
    void ensureTrackRecordingOnlyLogsFailures() {
        statuses.put(LIST_PARTICIPANTS, 500);
        assertThatCode(() -> room(apiUrl).ensureTrackRecording(55L)).doesNotThrowAnyException();
        assertThat(requests).doesNotContainKey(START_TRACK_EGRESS);

        statuses.remove(LIST_PARTICIPANTS);
        bodies.put(
                LIST_PARTICIPANTS,
                participants(participant("interviewer", track("TR_IA", TrackType.AUDIO))));
        statuses.put(START_TRACK_EGRESS, 500);
        assertThatCode(() -> room(apiUrl).ensureTrackRecording(55L)).doesNotThrowAnyException();
        assertThat(requests).containsKey(START_TRACK_EGRESS);
    }

    @Test
    void closeIgnoresFailures() {
        statuses.put("/twirp/livekit.RoomService/DeleteRoom", 500);
        room(apiUrl).close(55L);

        server.stop(0);
        room(apiUrl).close(55L);
    }

    @Test
    void removeGroupParticipantSendsRoomAndIdentityAndIgnoresFailures() throws Exception {
        String path = "/twirp/livekit.RoomService/RemoveParticipant";
        room(apiUrl).removeGroupParticipant(7L, 55L);

        RoomParticipantIdentity removed = RoomParticipantIdentity.parseFrom(requests.get(path));
        assertThat(removed.getRoom()).isEqualTo("group-7");
        assertThat(removed.getIdentity()).isEqualTo("candidate-55");

        // 이미 나간 참가자 · 서버 오류 · 연결 실패도 던지지 않는다
        statuses.put(path, 404);
        room(apiUrl).removeGroupParticipant(7L, 55L);
        statuses.put(path, 500);
        room(apiUrl).removeGroupParticipant(7L, 55L);
        server.stop(0);
        room(apiUrl).removeGroupParticipant(7L, 55L);
    }

    @Test
    void groupInfoAndAnswerGoToGroupRoomAndIgnoreFailures() throws Exception {
        String metadataPath = "/twirp/livekit.RoomService/UpdateRoomMetadata";
        String dataPath = "/twirp/livekit.RoomService/SendData";
        assertThat(room(apiUrl).updateGroupInfo(7L, "{\"turnVersion\":2}")).isTrue();
        assertThat(room(apiUrl).sendGroupAnswer(7L, "{\"seq\":1}")).isTrue();

        UpdateRoomMetadataRequest metadata =
                UpdateRoomMetadataRequest.parseFrom(requests.get(metadataPath));
        assertThat(metadata.getRoom()).isEqualTo("group-7");
        assertThat(metadata.getMetadata()).isEqualTo("{\"turnVersion\":2}");
        // 채팅 답변은 에이전트에게만 group.answer 주제로 보낸다
        SendDataRequest data = SendDataRequest.parseFrom(requests.get(dataPath));
        assertThat(data.getRoom()).isEqualTo("group-7");
        assertThat(data.getData().toStringUtf8()).isEqualTo("{\"seq\":1}");
        assertThat(data.getDestinationIdentitiesList()).containsExactly("interviewer");
        assertThat(data.getTopic()).isEqualTo("group.answer");
        assertThat(data.getKind()).isEqualTo(DataPacket.Kind.RELIABLE);
        JsonNode grant =
                claims(authorizations.get(metadataPath).substring("Bearer ".length()))
                        .path("video");
        assertThat(grant.path("roomAdmin").asBoolean()).isTrue();
        assertThat(grant.path("room").asString()).isEqualTo("group-7");

        // 서버 오류 · 연결 실패도 던지지 않고 실패만 알린다(업무는 이미 커밋했고 마감 처리기가 다시 보낸다)
        statuses.put(metadataPath, 500);
        statuses.put(dataPath, 500);
        assertThat(room(apiUrl).updateGroupInfo(7L, "{}")).isFalse();
        assertThat(room(apiUrl).sendGroupAnswer(7L, "{}")).isFalse();
        server.stop(0);
        assertThat(room(apiUrl).updateGroupInfo(7L, "{}")).isFalse();
        assertThat(room(apiUrl).sendGroupAnswer(7L, "{}")).isFalse();
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
        // 녹화 확인은 면접을 막지 않으므로 설정이 없으면 아무것도 하지 않는다
        assertThatCode(() -> unset.ensureTrackRecording(55L)).doesNotThrowAnyException();
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

    private static TrackInfo track(String sid, TrackType type) {
        return TrackInfo.newBuilder().setSid(sid).setType(type).build();
    }

    private static ParticipantInfo participant(String identity, TrackInfo... tracks) {
        return ParticipantInfo.newBuilder()
                .setIdentity(identity)
                .addAllTracks(List.of(tracks))
                .build();
    }

    private static byte[] participants(ParticipantInfo... participants) {
        return ListParticipantsResponse.newBuilder()
                .addAllParticipants(List.of(participants))
                .build()
                .toByteArray();
    }

    private static EgressInfo egress(String trackId, EgressStatus status) {
        return EgressInfo.newBuilder()
                .setStatus(status)
                .setTrack(TrackEgressRequest.newBuilder().setTrackId(trackId))
                .build();
    }

    private static byte[] egresses(EgressInfo... items) {
        return ListEgressResponse.newBuilder().addAllItems(List.of(items)).build().toByteArray();
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
