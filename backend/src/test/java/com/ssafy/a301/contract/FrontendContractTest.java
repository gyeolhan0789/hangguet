package com.ssafy.a301.contract;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import au.com.dius.pact.provider.junit5.HttpTestTarget;
import au.com.dius.pact.provider.junit5.PactVerificationContext;
import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider;
import au.com.dius.pact.provider.junitsupport.Provider;
import au.com.dius.pact.provider.junitsupport.State;
import au.com.dius.pact.provider.junitsupport.loader.PactFolder;
import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.domain.GrantTarget;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeCreateRequest;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeGrantRequest;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.admin.service.AdminNoticeService;
import com.ssafy.a301.admin.service.StreakFreezeGrantService;
import com.ssafy.a301.admin.service.StreakFreezeService;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.CoverLetterItemRequest;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue.Verdict;
import com.ssafy.a301.application.service.ApplicationService;
import com.ssafy.a301.auth.dto.AgreementRequest;
import com.ssafy.a301.auth.dto.SignupRequest;
import com.ssafy.a301.auth.dto.TokenResponse;
import com.ssafy.a301.auth.service.AuthService;
import com.ssafy.a301.common.idempotency.IdempotencyStore;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.company.service.CompanyCardManifest;
import com.ssafy.a301.company.service.CompanyCardWriter;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AttachmentFile;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryCreateRequest;
import com.ssafy.a301.inquiry.service.InquiryService;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.dto.InterviewDtos.AnswerRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.AiResultService;
import com.ssafy.a301.interview.service.AnswerService;
import com.ssafy.a301.interview.service.InterviewSessionService;
import com.ssafy.a301.storage.s3.PresignedUrl;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.storage.s3.StoredFile;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.service.UserService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.TestTemplate;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;

/**
 * FE가 만든 Pact 계약(frontend/pacts)을 실제로 띄운 BE로 검증한다. 상호작용마다 테스트가 하나씩 생긴다. 상황(given)은 BE 서비스로 만들고, 만든
 * 값(토큰 · id · 날짜)은 Map으로 돌려줘 요청에 넣는다. BE 밖으로 나가는 연결(LiveKit · S3 · AI 작업 큐 · 자기소개서 판단)만 가짜로 바꾼다.
 */
@Tag("contract")
@Provider("a301-backend")
@PactFolder("../frontend/pacts")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FrontendContractTest {
    private static final String PASSWORD = "abcd1234";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @LocalServerPort private int port;
    @Autowired private AuthService auth;
    @Autowired private UserService users;
    @Autowired private ApplicationService applications;
    @Autowired private InterviewSessionService sessions;
    @Autowired private AnswerService answers;
    @Autowired private AiResultService aiResults;
    @Autowired private SessionRuntimeStore runtimes;
    @Autowired private InterviewQuestionRepository questions;
    @Autowired private InquiryService inquiries;
    @Autowired private CompanyCardWriter companyCards;
    @Autowired private AdminRepository admins;
    @Autowired private AdminNoticeService notices;
    @Autowired private StreakFreezeGrantService grants;
    @Autowired private StreakFreezeService freezes;
    @Autowired private IdempotencyStore idempotency;
    @Autowired private JwtEncoder jwt;
    @Autowired private JdbcTemplate jdbc;
    @MockitoBean private CoverLetterCheckQueue coverLetterCheck;
    @MockitoBean private AiJobQueue aiJobs;
    @MockitoBean private InterviewRoom rooms;
    @MockitoBean private S3FileStorage storage;

    /** 이번 상호작용의 상황이 만든 값. 다음 상황이 이어서 쓴다(상호작용마다 테스트 인스턴스가 새로 생긴다). */
    private final Map<String, Object> values = new HashMap<>();

    private final ContractData created = new ContractData();

    @BeforeEach
    void target(PactVerificationContext context) {
        context.setTarget(new HttpTestTarget("localhost", port));
        when(coverLetterCheck.check(any(), any(), any())).thenReturn(Verdict.USABLE);
        when(rooms.issueAccess(anyLong(), anyBoolean()))
                .thenReturn(
                        new RoomResponse(
                                "wss://rtc.test",
                                "room-token",
                                OffsetDateTime.now().plusMinutes(10)));
        when(storage.presignUpload(anyString(), anyString(), anyLong()))
                .thenReturn(
                        new PresignedUrl(
                                "https://s3.test/upload", OffsetDateTime.now().plusMinutes(10)));
        when(storage.exists(anyString())).thenReturn(true);
        when(storage.find(anyString()))
                .thenReturn(Optional.of(new StoredFile("image/png", 204800L)));
        when(storage.presignDownload(anyString())).thenReturn("https://s3.test/download");
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider.class)
    void verify(PactVerificationContext context) {
        context.verifyInteraction();
    }

    @AfterEach
    void cleanup() {
        created.delete(jdbc);
    }

    @State("회원")
    Map<String, Object> member() {
        String email = "contract-" + UUID.randomUUID() + "@example.com";
        TokenResponse token = auth.signup(signup(email));
        created.users.add(token.user().id());
        values.put("userId", token.user().id());
        values.put("email", email);
        values.put("accessToken", token.accessToken());
        values.put("refreshToken", token.refreshToken());
        return values;
    }

    @State("가입하지 않은 이메일")
    Map<String, Object> newEmail() {
        String email = "contract-" + UUID.randomUUID() + "@example.com";
        created.emails.add(email);
        values.put("email", email);
        return values;
    }

    /** 비즈니스 로직은 언제나 지금부터 유효한 토큰을 발급하므로 만료된 토큰만 직접 서명한다(AuthControllerTest와 같음). */
    @State("만료된 토큰")
    Map<String, Object> expiredToken() {
        member();
        Instant issuedAt = Instant.now().minus(Duration.ofHours(2));
        values.put(
                "accessToken",
                jwt.encode(
                                JwtEncoderParameters.from(
                                        JwsHeader.with(MacAlgorithm.HS256).build(),
                                        JwtClaimsSet.builder()
                                                .issuer("a301")
                                                .subject(String.valueOf(userId()))
                                                .issuedAt(issuedAt)
                                                .expiresAt(issuedAt.plus(Duration.ofHours(1)))
                                                .build()))
                        .getTokenValue());
        return values;
    }

    @State("업로드한 프로필 사진")
    Map<String, Object> uploadedProfileImage() {
        values.put(
                "objectKey",
                users.profileImageUploadUrl(userId(), "image/png", 204800).objectKey());
        return values;
    }

    @State("지원서")
    Map<String, Object> application() {
        long id =
                applications
                        .create(
                                userId(),
                                new ApplicationCreateRequest(
                                        "○○전자",
                                        "백엔드 개발자",
                                        List.of(
                                                new CoverLetterItemRequest(
                                                        "지원 동기",
                                                        "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어 ○○전자 백엔드"
                                                                + " 직무에 지원했습니다."))))
                        .id();
        values.put("applicationId", id);
        return values;
    }

    @State("자기소개서를 쓸 수 없다고 판단한다")
    void coverLetterUnusable() {
        when(coverLetterCheck.check(any(), any(), any())).thenReturn(Verdict.UNUSABLE);
    }

    @State("자기소개서를 판단하지 못한다")
    void coverLetterUnavailable() {
        when(coverLetterCheck.check(any(), any(), any())).thenReturn(Verdict.UNAVAILABLE);
    }

    /**
     * 면접을 단계(stage)까지 진행한다. GENERATING(질문 준비 중) · PLAN_FAILED · PLAN_READY · IN_PROGRESS(1번 질문) ·
     * ANSWERED(1번 답함) · ANALYZING · COMPLETED · ABORTED(답 없이 끝냄). previousDay면 먼저 어제 결과가 나온 면접을 하나
     * 둔다.
     */
    @State("면접")
    Map<String, Object> interview(Map<String, Object> params) {
        String stage = (String) params.get("stage");
        InterviewMode mode = InterviewMode.valueOf((String) params.getOrDefault("mode", "CHAT"));
        if (!values.containsKey("applicationId")) {
            application();
        }
        if (Boolean.TRUE.equals(params.get("previousDay"))) {
            completedYesterday(mode);
        }
        long sessionId =
                sessions.create(
                                userId(),
                                new SessionCreateRequest(
                                        (Long) values.get("applicationId"), Persona.DEVIL, mode))
                        .id();
        values.put("sessionId", sessionId);
        values.put("practiceDate", KoreaTime.today().toString());
        values.put("month", KoreaTime.today().toString().substring(0, 7));
        if (stage.equals("GENERATING")) {
            return values;
        }
        if (stage.equals("PLAN_FAILED")) {
            aiResult(Map.of("type", "plan.failed", "sessionId", sessionId));
            return values;
        }
        aiResult(planCompleted(sessionId));
        if (stage.equals("PLAN_READY")) {
            return values;
        }
        sessions.start(userId(), sessionId);
        aiResult(
                Map.of(
                        "type",
                        "question.started",
                        "sessionId",
                        sessionId,
                        "seq",
                        1,
                        "startedAt",
                        OffsetDateTime.now().toString(),
                        "content",
                        "질문1",
                        "criteria",
                        "기준"));
        long questionId =
                questions.findFirstBySessionIdOrderBySeqDesc(sessionId).orElseThrow().getId();
        values.put("questionId", questionId);
        if (stage.equals("IN_PROGRESS")) {
            return values;
        }
        if (stage.equals("ABORTED")) {
            sessions.end(userId(), sessionId, null);
            return values;
        }
        long answerId =
                answers.submit(
                                userId(),
                                sessionId,
                                questionId,
                                new AnswerRequest(InputType.TEXT, "캐시 무효화 시점을 직접 설계했습니다."))
                        .id();
        if (stage.equals("ANSWERED")) {
            return values;
        }
        sessions.end(userId(), sessionId, null);
        if (stage.equals("COMPLETED")) {
            aiResult(evaluationCompleted(sessionId, answerId, 70));
        }
        return values;
    }

    /**
     * 어제 결과가 나온 면접(오늘보다 낮은 점수). 서비스는 언제나 지금 시각으로 기록하므로 만든 뒤 날짜만 하루 앞으로 옮긴다(만료된 토큰처럼 비즈니스 로직으로 만들 수
     * 없는 예외).
     */
    private void completedYesterday(InterviewMode mode) {
        interview(Map.of("stage", "ANALYZING", "mode", mode.name()));
        long sessionId = (Long) values.get("sessionId");
        long answerId =
                jdbc.queryForObject(
                        "SELECT a.id FROM answers a JOIN interview_questions q ON q.id ="
                                + " a.question_id WHERE q.session_id = ?",
                        Long.class,
                        sessionId);
        aiResult(evaluationCompleted(sessionId, answerId, 60));
        jdbc.update(
                "UPDATE interview_sessions SET started_at = started_at - INTERVAL '1 day', ended_at"
                    + " = ended_at - INTERVAL '1 day', created_at = created_at - INTERVAL '1 day'"
                    + " WHERE id = ?",
                sessionId);
        jdbc.update(
                "UPDATE practice_logs SET practice_date = practice_date - 1, created_at ="
                        + " created_at - INTERVAL '1 day' WHERE user_id = ?",
                userId());
    }

    /**
     * 같은 키를 다른 요청이 이미 잡아 두었다(지문이 달라 IDEMPOTENCY_KEY_REUSED). 멱등 처리는 서비스가 아니라 HTTP
     * 인터셉터(IdempotencyInterceptor)에만 있어 저장소에 직접 잡아 둔다.
     */
    @State("다른 요청에 쓴 멱등 키")
    void idempotencyKeyTaken(Map<String, Object> params) {
        idempotency.begin(userId(), UUID.fromString((String) params.get("key")), "other-request");
    }

    @State("스트릭 유지권")
    Map<String, Object> streakFreeze() {
        grants.grant(
                admin(),
                new StreakFreezeGrantRequest(
                        GrantTarget.USERS,
                        List.of(userId()),
                        1,
                        KoreaTime.today(),
                        KoreaTime.today().minusDays(1),
                        null));
        values.put("freezeId", freezes.mine(userId()).freezes().getFirst().id());
        return values;
    }

    @State("공지")
    Map<String, Object> notice() {
        long id =
                notices.create(
                                admin(),
                                new NoticeCreateRequest(
                                        "10월 점검 안내",
                                        "10월 30일 02:00~04:00 서비스 점검이 있어요.",
                                        OffsetDateTime.now().minusHours(1),
                                        null))
                        .id();
        created.notices.add(id);
        values.put("noticeId", id);
        return values;
    }

    @State("업로드한 문의 사진")
    Map<String, Object> uploadedInquiryPhoto() {
        values.put("objectKey", inquiryPhotoKey());
        return values;
    }

    /** photo면 첫 질문에 사진을 하나 붙인다 */
    @State("문의")
    Map<String, Object> inquiry(Map<String, Object> params) {
        long id = inquiries.create(userId(), inquiryRequest(null, null, photos(params))).id();
        if (Boolean.TRUE.equals(params.get("closed"))) {
            inquiries.close(userId(), id, null);
        }
        values.put("inquiryId", id);
        return values;
    }

    @State("비회원 문의")
    Map<String, Object> guestInquiry() {
        long id =
                inquiries.create(null, inquiryRequest(ContractData.GUEST_EMAIL, "1234", null)).id();
        values.put("inquiryId", id);
        return values;
    }

    /** 회사는 파이프라인이 올린 manifest로만 생기므로 적재기(CompanyCardWriter)로 하나 넣는다 */
    @State("적재한 회사")
    Map<String, Object> company() throws NoSuchAlgorithmException {
        byte[] card = "{}".getBytes(StandardCharsets.UTF_8);
        companyCards.apply(
                new CompanyCardManifest.Entry(
                        ContractData.CORP_CODE,
                        "계약검증회사",
                        true,
                        List.of("계약검증회사"),
                        LocalDate.of(2026, 10, 20),
                        "contract/card.json",
                        HexFormat.of()
                                .formatHex(MessageDigest.getInstance("SHA-256").digest(card))),
                key -> card);
        return values;
    }

    private String inquiryPhotoKey() {
        return inquiries
                .attachmentUploadUrls(List.of(new AttachmentFile("image/png", 204800L)))
                .files()
                .get(0)
                .objectKey();
    }

    private List<String> photos(Map<String, Object> params) {
        return Boolean.TRUE.equals(params.get("photo")) ? List.of(inquiryPhotoKey()) : null;
    }

    private long userId() {
        return (Long) values.get("userId");
    }

    private long admin() {
        long id =
                admins.saveAndFlush(new Admin("contract-" + UUID.randomUUID(), "hash", "계약 검증"))
                        .getId();
        created.admins.add(id);
        return id;
    }

    private void aiResult(Map<String, Object> message) {
        aiResults.handle(JSON.writeValueAsString(message));
    }

    private static SignupRequest signup(String email) {
        return new SignupRequest(
                email,
                PASSWORD,
                "면접왕",
                List.of(
                        new AgreementRequest(TermsType.TERMS, "1.0"),
                        new AgreementRequest(TermsType.PRIVACY, "1.0"),
                        new AgreementRequest(TermsType.RECORDING, "1.0")));
    }

    private static InquiryCreateRequest inquiryRequest(
            String email, String accessPassword, List<String> attachmentKeys) {
        return new InquiryCreateRequest(
                "비밀번호를 잊어버렸어요",
                "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.",
                email,
                accessPassword,
                attachmentKeys);
    }

    private static Map<String, Object> planCompleted(long sessionId) {
        return Map.of(
                "type",
                "plan.completed",
                "sessionId",
                sessionId,
                "claims",
                List.of(),
                "questions",
                IntStream.rangeClosed(1, 5)
                        .mapToObj(
                                seq ->
                                        Map.of(
                                                "seq",
                                                seq,
                                                "content",
                                                "질문" + seq,
                                                "criteria",
                                                "기준",
                                                "claimId",
                                                "c1"))
                        .toList(),
                "promptVersion",
                "plan-v1",
                "modelVersion",
                "contract");
    }

    private Map<String, Object> evaluationCompleted(long sessionId, long answerId, int score) {
        return Map.of(
                "type",
                "evaluation.completed",
                "sessionId",
                sessionId,
                "jobId",
                runtimes.findEvaluateJobId(sessionId).orElseThrow().toString(),
                "answers",
                List.of(
                        Map.of(
                                "answerId",
                                answerId,
                                "score",
                                80,
                                "goodPoint",
                                "잘한 점",
                                "improvePoint",
                                "고칠 점",
                                "evaluation",
                                Map.of("scoreMethod", "FINAL"))),
                "sessionScores",
                List.of(Criterion.values()).stream()
                        .map(
                                c ->
                                        Map.<String, Object>of(
                                                "criterion",
                                                c.name(),
                                                "score",
                                                score,
                                                "comment",
                                                "결론부터 말했어요"))
                        .toList(),
                "headline",
                "근거는 분명하나 결론이 늦어요",
                "summary",
                "꼬리 질문엔 근거부터 짧게");
    }
}
