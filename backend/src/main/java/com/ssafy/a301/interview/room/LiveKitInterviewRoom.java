package com.ssafy.a301.interview.room;

import com.google.protobuf.ByteString;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import io.livekit.server.AccessToken;
import io.livekit.server.AgentDispatchServiceClient;
import io.livekit.server.CanPublish;
import io.livekit.server.CanPublishData;
import io.livekit.server.CanPublishSources;
import io.livekit.server.CanSubscribe;
import io.livekit.server.EgressServiceClient;
import io.livekit.server.RoomAdmin;
import io.livekit.server.RoomCreate;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import io.livekit.server.RoomService;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import livekit.LivekitEgress.AutoTrackEgress;
import livekit.LivekitEgress.DirectFileOutput;
import livekit.LivekitEgress.EgressInfo;
import livekit.LivekitEgress.EgressStatus;
import livekit.LivekitEgress.S3Upload;
import livekit.LivekitModels.DataPacket;
import livekit.LivekitModels.ParticipantInfo;
import livekit.LivekitModels.TrackInfo;
import livekit.LivekitModels.TrackType;
import livekit.LivekitRoom.CreateRoomRequest;
import livekit.LivekitRoom.DeleteRoomRequest;
import livekit.LivekitRoom.ListParticipantsRequest;
import livekit.LivekitRoom.RoomEgress;
import livekit.LivekitRoom.RoomParticipantIdentity;
import livekit.LivekitRoom.SendDataRequest;
import livekit.LivekitRoom.UpdateRoomMetadataRequest;
import okhttp3.OkHttpClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import retrofit2.Call;
import retrofit2.Response;
import retrofit2.Retrofit;
import retrofit2.converter.protobuf.ProtoConverterFactory;
import tools.jackson.databind.json.JsonMapper;

/**
 * LiveKit 서버 API로 면접방을 다룬다. 개발(Cloud)과 운영(셀프 호스팅)에서 주소·키만 다르고, Cloud 전용 기능은 쓰지 않는다(배포 계획 4.0). 녹화는
 * 방을 만들 때 켜는 트랙 자동 녹화다. 방을 만들 때는 아직 트랙이 없어 트랙마다 녹화를 시작할 수 없기 때문이다.
 */
@Component
public class LiveKitInterviewRoom implements InterviewRoom {
    private static final Logger LOG = LoggerFactory.getLogger(LiveKitInterviewRoom.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    // 호출 하나의 시간 제한(BE 설계 5.2). 5.4 · 10.7은 면접 · 그룹 행을 잠근 채 방 만들기·배정(실패하면 방 지우기까지)을 부르므로 최대 15초다
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    static final String CANDIDATE = "candidate";
    // 채팅 최종 답변을 에이전트에게 보내는 메시지 주제(AI 명세 6.7)
    static final String GROUP_ANSWER_TOPIC = "group.answer";
    // 아무도 들어오지 않았거나 모두 나간 방을 닫는 시간(초). 입장 토큰 유효 시간과 같다
    private static final int EMPTY_TIMEOUT_SECONDS = 600;
    // 개인 화상 면접방에서 녹화해야 하는 트랙(AI 명세 7장 원본 트랙 파일): 지원자 영상 · 음성, 면접관 음성
    private static final List<RecordedTrack> RECORDED_TRACKS =
            List.of(
                    new RecordedTrack(CANDIDATE, TrackType.VIDEO),
                    new RecordedTrack(CANDIDATE, TrackType.AUDIO),
                    new RecordedTrack(INTERVIEWER, TrackType.AUDIO));
    // 녹화 중인 것으로 보는 상태. 시작 중인 녹화도 넣어 같은 트랙을 두 번 녹화하지 않게 한다
    private static final Set<EgressStatus> RECORDING =
            Set.of(EgressStatus.EGRESS_STARTING, EgressStatus.EGRESS_ACTIVE);
    // 브라우저에 알려 줄 주소와 BE가 서버 API를 부르는 주소의 설정 이름. 시험이 같은 이름으로 실제 값을 확인한다.
    // livekit.url로 두면 Spring이 환경 변수 LIVEKIT_URL(서버 주소)을 그 이름으로 읽어 LIVEKIT_PUBLIC_URL을 덮어쓴다
    static final String URL_PROPERTY = "${livekit.public-url}";
    static final String API_URL_PROPERTY = "${livekit.api-url}";

    private final String url;
    private final String apiUrl;
    private final String apiKey;
    private final String apiSecret;
    private final String agentName;
    private final Duration tokenTtl;
    private final S3Upload egressS3;
    private RoomService rooms;
    private AgentDispatchServiceClient dispatches;
    private EgressServiceClient egresses;

    public LiveKitInterviewRoom(
            @Value(URL_PROPERTY) String url,
            @Value(API_URL_PROPERTY) String apiUrl,
            @Value("${livekit.api-key}") String apiKey,
            @Value("${livekit.api-secret}") String apiSecret,
            @Value("${livekit.agent-name}") String agentName,
            @Value("${livekit.token-ttl}") Duration tokenTtl,
            @Value("${livekit.egress-s3.access-key}") String egressAccessKey,
            @Value("${livekit.egress-s3.secret}") String egressSecret,
            @Value("${livekit.egress-s3.bucket}") String egressBucket,
            @Value("${livekit.egress-s3.region}") String egressRegion) {
        this.url = url;
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.agentName = agentName;
        this.tokenTtl = tokenTtl;
        this.egressS3 =
                egressAccessKey.isBlank()
                        ? null
                        : S3Upload.newBuilder()
                                .setAccessKey(egressAccessKey)
                                .setSecret(egressSecret)
                                .setBucket(egressBucket)
                                .setRegion(egressRegion)
                                .build();
    }

    @Override
    public RoomResponse issueAccess(long sessionId, boolean video) {
        return access(roomName(sessionId), CANDIDATE, video);
    }

    @Override
    public void open(long sessionId, boolean video, Map<String, Object> assignment) {
        open(roomName(sessionId), Recording.rawPrefix(sessionId), video, assignment, null);
    }

    @Override
    public void close(long sessionId) {
        delete(roomName(sessionId));
    }

    @Override
    public Presence presence(long sessionId) {
        requireConfigured();
        String room = roomName(sessionId);
        try {
            List<ParticipantInfo> participants = participants(room);
            boolean interviewer =
                    participants.stream().anyMatch(p -> INTERVIEWER.equals(p.getIdentity()));
            OffsetDateTime candidateJoinedAt =
                    participants.stream()
                            .filter(p -> CANDIDATE.equals(p.getIdentity()))
                            .findFirst()
                            .map(LiveKitInterviewRoom::joinedAt)
                            .orElse(null);
            return new Presence(interviewer, candidateJoinedAt);
        } catch (IOException ex) {
            throw new UncheckedIOException("면접방 참가자를 조회하지 못했다: room=" + room, ex);
        }
    }

    @Override
    public void ensureTrackRecording(long sessionId) {
        if (!isConfigured()) {
            return;
        }
        String room = roomName(sessionId);
        try {
            List<ParticipantInfo> participants = participants(room);
            Set<String> recording =
                    execute(egresses().listEgress(room, null, true)).stream()
                            .filter(egress -> RECORDING.contains(egress.getStatus()))
                            .filter(EgressInfo::hasTrack)
                            .map(egress -> egress.getTrack().getTrackId())
                            .collect(Collectors.toSet());
            for (RecordedTrack expected : RECORDED_TRACKS) {
                List<TrackInfo> published = expected.published(participants);
                if (published.isEmpty()) {
                    LOG.warn("녹화할 트랙이 면접방에 없다: room={} track={}", room, expected);
                }
                published.stream()
                        .filter(track -> !recording.contains(track.getSid()))
                        .forEach(track -> restartTrackEgress(sessionId, expected, track.getSid()));
            }
        } catch (IOException | RuntimeException ex) {
            LOG.warn("트랙 녹화 상태를 확인하지 못했다: room={}", room, ex);
        }
    }

    // 녹화가 시작되지 않은 트랙만 녹화를 다시 요청한다. 실패하면 녹화 없이 면접을 진행한다.
    // 파일 이름은 자동 녹화와 같은 규칙({참가자}-{종류}-{트랙 id})에 -retry를 붙인다. 자동 녹화가 늦게 시작해도 같은 파일을 덮어쓰지 않는다
    private void restartTrackEgress(long sessionId, RecordedTrack expected, String trackId) {
        String room = roomName(sessionId);
        LOG.warn(
                "녹화가 시작되지 않은 트랙의 녹화를 다시 요청한다: room={} track={} trackId={}",
                room,
                expected,
                trackId);
        DirectFileOutput.Builder output =
                DirectFileOutput.newBuilder()
                        .setFilepath(
                                Recording.rawPrefix(sessionId)
                                        + expected.filePrefix()
                                        + trackId
                                        + "-retry")
                        .setDisableManifest(true);
        if (egressS3 != null) {
            output.setS3(egressS3);
        }
        try {
            execute(egresses().startTrackEgress(room, output.build(), trackId));
        } catch (IOException | RuntimeException ex) {
            LOG.warn("트랙 녹화를 다시 요청하지 못했다: room={} trackId={}", room, trackId, ex);
        }
    }

    /** 녹화해야 하는 트랙. 참가자 이름과 트랙 종류로 정한다 */
    private record RecordedTrack(String identity, TrackType type) {
        List<TrackInfo> published(List<ParticipantInfo> participants) {
            return participants.stream()
                    .filter(participant -> identity.equals(participant.getIdentity()))
                    .flatMap(participant -> participant.getTracksList().stream())
                    .filter(track -> track.getType() == type)
                    .toList();
        }

        // 자동 녹화 파일 이름의 앞부분({publisher_identity}-{track_type}-). 합치기가 이 앞부분으로 트랙을 찾는다
        String filePrefix() {
            return identity + "-" + type.name().toLowerCase(Locale.ROOT) + "-";
        }
    }

    // 면접방 참가자 목록. 방이 없으면 비어 있다
    private List<ParticipantInfo> participants(String room) throws IOException {
        return execute(
                        rooms().listParticipants(
                                        ListParticipantsRequest.newBuilder().setRoom(room).build(),
                                        roomAdminAuth(room)))
                .getParticipantsList();
    }

    // 입장 시각. 밀리초 값이 없는(0) 서버면 초 값을 쓴다
    private static OffsetDateTime joinedAt(ParticipantInfo participant) {
        Instant joined =
                participant.getJoinedAtMs() > 0
                        ? Instant.ofEpochMilli(participant.getJoinedAtMs())
                        : Instant.ofEpochSecond(participant.getJoinedAt());
        return OffsetDateTime.ofInstant(joined, KoreaTime.ZONE);
    }

    @Override
    public RoomResponse issueGroupAccess(long groupId, long sessionId, boolean video) {
        return access(groupRoomName(groupId), InterviewRoom.groupCandidate(sessionId), video);
    }

    @Override
    public void openGroup(
            long groupId, boolean video, Map<String, Object> assignment, String metadata) {
        open(
                groupRoomName(groupId),
                Recording.groupRawPrefix(groupId),
                video,
                assignment,
                metadata);
    }

    @Override
    public void closeGroup(long groupId) {
        delete(groupRoomName(groupId));
    }

    @Override
    public Optional<GroupPresence> groupPresence(long groupId) {
        if (!isConfigured()) {
            return Optional.empty();
        }
        String room = groupRoomName(groupId);
        try {
            List<ParticipantInfo> participants = participants(room);
            return Optional.of(
                    new GroupPresence(
                            participants.stream()
                                    .anyMatch(p -> INTERVIEWER.equals(p.getIdentity())),
                            participants.stream()
                                    .map(ParticipantInfo::getIdentity)
                                    .map(InterviewRoom::groupCandidateSession)
                                    .flatMap(Optional::stream)
                                    .collect(Collectors.toSet())));
        } catch (IOException ex) {
            throw new UncheckedIOException("그룹 면접방 참가자를 조회하지 못했다: room=" + room, ex);
        }
    }

    @Override
    public void removeGroupParticipant(long groupId, long sessionId) {
        if (!isConfigured()) {
            return;
        }
        String room = groupRoomName(groupId);
        String identity = InterviewRoom.groupCandidate(sessionId);
        try {
            Response<?> response =
                    rooms().removeParticipant(
                                    RoomParticipantIdentity.newBuilder()
                                            .setRoom(room)
                                            .setIdentity(identity)
                                            .build(),
                                    roomAdminAuth(room))
                            .execute();
            // 이미 나간 참가자 · 닫힌 방은 그대로 둔다
            if (!response.isSuccessful() && response.code() != 404) {
                LOG.warn(
                        "참가자를 내보내지 못했다: room={} identity={} status={}",
                        room,
                        identity,
                        response.code());
            }
        } catch (IOException | RuntimeException ex) {
            LOG.warn("참가자를 내보내지 못했다: room={} identity={}", room, identity, ex);
        }
    }

    @Override
    public boolean updateGroupInfo(long groupId, String metadata) {
        // 설정이 없으면(로컬) 보낼 곳이 없으므로 다시 보내지 않게 보낸 것으로 본다
        if (!isConfigured()) {
            return true;
        }
        String room = groupRoomName(groupId);
        try {
            execute(
                    rooms().updateRoomMetadata(
                                    UpdateRoomMetadataRequest.newBuilder()
                                            .setRoom(room)
                                            .setMetadata(metadata)
                                            .build(),
                                    roomAdminAuth(room)));
            return true;
        } catch (IOException | RuntimeException ex) {
            LOG.warn("면접방 정보를 바꾸지 못했다: room={}", room, ex);
            return false;
        }
    }

    @Override
    public boolean sendGroupAnswer(long groupId, String payload) {
        // 설정이 없으면(로컬) 보낼 곳이 없으므로 다시 보내지 않게 보낸 것으로 본다
        if (!isConfigured()) {
            return true;
        }
        String room = groupRoomName(groupId);
        try {
            execute(
                    rooms().sendData(
                                    SendDataRequest.newBuilder()
                                            .setRoom(room)
                                            .setData(
                                                    ByteString.copyFrom(
                                                            payload, StandardCharsets.UTF_8))
                                            .setKind(DataPacket.Kind.RELIABLE)
                                            .addDestinationIdentities(INTERVIEWER)
                                            .setTopic(GROUP_ANSWER_TOPIC)
                                            .build(),
                                    roomAdminAuth(room)));
            return true;
        } catch (IOException | RuntimeException ex) {
            LOG.warn("채팅 답변을 에이전트에게 보내지 못했다: room={}", room, ex);
            return false;
        }
    }

    private RoomResponse access(String room, String identity, boolean video) {
        requireConfigured();
        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.setIdentity(identity);
        token.setTtl(tokenTtl.toMillis());
        token.addGrants(
                new RoomJoin(true),
                new RoomName(room),
                new CanSubscribe(true),
                new CanPublishData(true),
                new CanPublish(video));
        if (video) {
            token.addGrants(new CanPublishSources(List.of("camera", "microphone")));
        }
        OffsetDateTime expiresAt = KoreaTime.now().plus(tokenTtl);
        return new RoomResponse(url, token.toJwt(), expiresAt);
    }

    // metadata는 면접방 정보(그룹 면접만). 개인 면접은 null이다
    private void open(
            String room,
            String rawPrefix,
            boolean video,
            Map<String, Object> assignment,
            String metadata) {
        requireConfigured();
        try {
            CreateRoomRequest.Builder request =
                    CreateRoomRequest.newBuilder()
                            .setName(room)
                            .setEmptyTimeout(EMPTY_TIMEOUT_SECONDS)
                            .setDepartureTimeout(EMPTY_TIMEOUT_SECONDS);
            if (metadata != null) {
                request.setMetadata(metadata);
            }
            if (video) {
                request.setEgress(RoomEgress.newBuilder().setTracks(trackEgress(rawPrefix)));
            }
            execute(rooms().createRoom(request.build(), adminAuth()));
            execute(
                    dispatches()
                            .createDispatch(room, agentName, JSON.writeValueAsString(assignment)));
        } catch (IOException | RuntimeException ex) {
            LOG.warn("면접방을 열지 못했다: room={}", room, ex);
            delete(room);
            throw new ApiException(ErrorCode.ROOM_UNAVAILABLE);
        }
    }

    private void delete(String room) {
        if (!isConfigured()) {
            return;
        }
        try {
            Response<Void> response =
                    rooms().deleteRoom(
                                    DeleteRoomRequest.newBuilder().setRoom(room).build(),
                                    adminAuth())
                            .execute();
            // 이미 없는 방(빈 방 시간 초과로 닫힘)은 그대로 둔다
            if (!response.isSuccessful() && response.code() != 404) {
                LOG.warn("면접방을 지우지 못했다: room={} status={}", room, response.code());
            }
        } catch (IOException | RuntimeException ex) {
            LOG.warn("면접방을 지우지 못했다: room={}", room, ex);
        }
    }

    // 트랙마다 {원본 위치}{참가자}-{종류}-{트랙 id}.{확장자}로 올린다. 원본 위치는 recordings/raw/{sessionId}/(그룹은
    // recordings/raw/group-{groupId}/), 종류는 video·audio(소문자), 트랙 id는 LiveKit 서버가 붙이고(같은 트랙을 다시 올려도
    // 덮어쓰지 않음) 확장자는 Egress가 코덱에 맞춰 붙인다(H.264 mp4, Opus ogg)
    private AutoTrackEgress trackEgress(String rawPrefix) {
        AutoTrackEgress.Builder egress =
                AutoTrackEgress.newBuilder()
                        .setFilepath(rawPrefix + "{publisher_identity}-{track_type}")
                        .setDisableManifest(true);
        if (egressS3 != null) {
            egress.setS3(egressS3);
        }
        return egress.build();
    }

    static String roomName(long sessionId) {
        return "interview-" + sessionId;
    }

    static String groupRoomName(long groupId) {
        return "group-" + groupId;
    }

    // 방 만들기·지우기 권한
    private String adminAuth() {
        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.addGrants(new RoomCreate(true));
        token.setTtl(TimeUnit.MINUTES.toMillis(1));
        return "Bearer " + token.toJwt();
    }

    // 방 하나의 관리 권한(참가자 조회 · 내보내기)
    private String roomAdminAuth(String room) {
        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.addGrants(new RoomAdmin(true), new RoomName(room));
        token.setTtl(TimeUnit.MINUTES.toMillis(1));
        return "Bearer " + token.toJwt();
    }

    private static <T> T execute(Call<T> call) throws IOException {
        Response<T> response = call.execute();
        if (!response.isSuccessful()) {
            try (var error = response.errorBody()) {
                throw new IOException(
                        "LiveKit 응답 "
                                + response.code()
                                + " "
                                + (error == null ? "" : error.string()));
            }
        }
        return response.body();
    }

    private synchronized RoomService rooms() {
        if (rooms == null) {
            rooms =
                    new Retrofit.Builder()
                            .baseUrl(httpUrl(apiUrl))
                            .addConverterFactory(ProtoConverterFactory.create())
                            .client(httpClient())
                            .build()
                            .create(RoomService.class);
        }
        return rooms;
    }

    private synchronized AgentDispatchServiceClient dispatches() {
        if (dispatches == null) {
            dispatches =
                    AgentDispatchServiceClient.createClient(
                            httpUrl(apiUrl), apiKey, apiSecret, LiveKitInterviewRoom::httpClient);
        }
        return dispatches;
    }

    private synchronized EgressServiceClient egresses() {
        if (egresses == null) {
            egresses =
                    EgressServiceClient.createClient(
                            httpUrl(apiUrl), apiKey, apiSecret, LiveKitInterviewRoom::httpClient);
        }
        return egresses;
    }

    private static OkHttpClient httpClient() {
        return new OkHttpClient.Builder()
                .connectTimeout(TIMEOUT)
                .readTimeout(TIMEOUT)
                .callTimeout(TIMEOUT)
                .build();
    }

    // 서버 API는 HTTP다. 접속 주소(ws·wss)를 그대로 받아도 되게 바꾼다
    static String httpUrl(String address) {
        String http = address.replaceFirst("^ws://", "http://").replaceFirst("^wss://", "https://");
        return http.endsWith("/") ? http : http + "/";
    }

    private boolean isConfigured() {
        return !url.isBlank() && !apiUrl.isBlank() && !apiKey.isBlank() && !apiSecret.isBlank();
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            LOG.warn("LIVEKIT_URL·LIVEKIT_API_KEY·LIVEKIT_API_SECRET이 없어 면접방을 쓸 수 없다");
            throw new ApiException(ErrorCode.ROOM_UNAVAILABLE);
        }
    }
}
