package com.ssafy.a301.interview.room;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import io.livekit.server.AccessToken;
import io.livekit.server.AgentDispatchServiceClient;
import io.livekit.server.CanPublish;
import io.livekit.server.CanPublishData;
import io.livekit.server.CanPublishSources;
import io.livekit.server.CanSubscribe;
import io.livekit.server.RoomCreate;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import io.livekit.server.RoomService;
import java.io.IOException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import livekit.LivekitEgress.AutoTrackEgress;
import livekit.LivekitEgress.S3Upload;
import livekit.LivekitRoom.CreateRoomRequest;
import livekit.LivekitRoom.DeleteRoomRequest;
import livekit.LivekitRoom.RoomEgress;
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
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final JsonMapper JSON = JsonMapper.builder().build();
    // 호출 하나의 시간 제한(BE 설계 5.2). 5.4는 면접 행을 잠근 채 방 만들기·배정(실패하면 방 지우기까지)을 부르므로 최대 15초다
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    static final String CANDIDATE = "candidate";
    // 아무도 들어오지 않았거나 모두 나간 방을 닫는 시간(초). 입장 토큰 유효 시간과 같다
    private static final int EMPTY_TIMEOUT_SECONDS = 600;

    private final String url;
    private final String apiUrl;
    private final String apiKey;
    private final String apiSecret;
    private final String agentName;
    private final Duration tokenTtl;
    private final S3Upload egressS3;
    private RoomService rooms;
    private AgentDispatchServiceClient dispatches;

    public LiveKitInterviewRoom(
            @Value("${livekit.url}") String url,
            @Value("${livekit.api-url}") String apiUrl,
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
        requireConfigured();
        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.setIdentity(CANDIDATE);
        token.setTtl(tokenTtl.toMillis());
        token.addGrants(
                new RoomJoin(true),
                new RoomName(roomName(sessionId)),
                new CanSubscribe(true),
                new CanPublishData(true),
                new CanPublish(video));
        if (video) {
            token.addGrants(new CanPublishSources(List.of("camera", "microphone")));
        }
        OffsetDateTime expiresAt = OffsetDateTime.now(KST).plus(tokenTtl);
        return new RoomResponse(url, token.toJwt(), expiresAt);
    }

    @Override
    public void open(long sessionId, boolean video, Map<String, Object> assignment) {
        requireConfigured();
        String room = roomName(sessionId);
        try {
            CreateRoomRequest.Builder request =
                    CreateRoomRequest.newBuilder()
                            .setName(room)
                            .setEmptyTimeout(EMPTY_TIMEOUT_SECONDS)
                            .setDepartureTimeout(EMPTY_TIMEOUT_SECONDS);
            if (video) {
                request.setEgress(RoomEgress.newBuilder().setTracks(trackEgress(sessionId)));
            }
            execute(rooms().createRoom(request.build(), adminAuth()));
            execute(
                    dispatches()
                            .createDispatch(room, agentName, JSON.writeValueAsString(assignment)));
        } catch (IOException | RuntimeException ex) {
            LOG.warn("면접방을 열지 못했다: room={}", room, ex);
            close(sessionId);
            throw new ApiException(ErrorCode.ROOM_UNAVAILABLE);
        }
    }

    @Override
    public void close(long sessionId) {
        if (!isConfigured()) {
            return;
        }
        String room = roomName(sessionId);
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

    // 트랙마다 recordings/raw/{sessionId}/{참가자}-{종류}-{트랙 id}.{확장자}로 올린다. 종류는 video·audio(소문자), 트랙 id는
    // LiveKit 서버가
    // 붙이고(같은 트랙을 다시 올려도 덮어쓰지 않음) 확장자는 Egress가 코덱에 맞춰 붙인다(H.264 mp4, Opus ogg)
    private AutoTrackEgress trackEgress(long sessionId) {
        AutoTrackEgress.Builder egress =
                AutoTrackEgress.newBuilder()
                        .setFilepath(
                                Recording.rawPrefix(sessionId)
                                        + "{publisher_identity}-{track_type}")
                        .setDisableManifest(true);
        if (egressS3 != null) {
            egress.setS3(egressS3);
        }
        return egress.build();
    }

    static String roomName(long sessionId) {
        return "interview-" + sessionId;
    }

    // 방 만들기·지우기 권한
    private String adminAuth() {
        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.addGrants(new RoomCreate(true));
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
