package com.ssafy.a301.company;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.company.config.CompanyCardProperties;
import com.ssafy.a301.company.repository.CompanyCardImportRepository;
import com.ssafy.a301.company.service.CompanyCardImporter;
import com.ssafy.a301.company.service.CompanyCardImporter.ImportResult;
import com.ssafy.a301.company.service.CompanyCardSource;
import com.ssafy.a301.company.service.CompanyCardWriter;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL로 회사 카드 적재(docs/ERD-회사카드.md)를 확인한다. 공용 버킷은 가짜 CompanyCardSource로 대신한다. 고유번호는 실제 DART
 * 고유번호와 겹치지 않게 9로 시작하고, 끝나면 이 테스트가 만든 행만 지운다.
 *
 * <p>버킷 설정·가짜 버킷을 빈으로 바꿔 넣지 않고 적재기를 직접 만든다. 설정이 다른 테스트 컨텍스트가 늘면 컨텍스트마다 DB 연결 풀(10개)이 남아 CI
 * PostgreSQL 연결 수 한도(100)를 넘는다.
 */
@SpringBootTest
class CompanyCardImportIntegrationTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String SDS = "99000001";
    private static final String KAKAO = "99000002";

    @Autowired private CompanyCardWriter writer;
    @Autowired private CompanyCardImportRepository imports;
    @Autowired private JdbcTemplate jdbc;

    private final CompanyCardSource source = mock(CompanyCardSource.class);
    private CompanyCardImporter importer;

    private final Map<String, byte[]> files = new LinkedHashMap<>();
    private final List<String> runIds = new ArrayList<>();
    private final List<Long> userIds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        importer =
                new CompanyCardImporter(
                        source,
                        writer,
                        imports,
                        new CompanyCardProperties("test-company-bucket", Duration.ofDays(30)));
    }

    @AfterEach
    void cleanup() {
        for (long userId : userIds) {
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", userId);
            jdbc.update("DELETE FROM applications WHERE user_id = ?", userId);
            jdbc.update("DELETE FROM users WHERE id = ?", userId);
        }
        for (String code : List.of(SDS, KAKAO)) {
            jdbc.update(
                    "DELETE FROM company_cards WHERE company_id IN"
                            + " (SELECT id FROM companies WHERE corp_code = ?)",
                    code);
            jdbc.update(
                    "DELETE FROM company_aliases WHERE company_id IN"
                            + " (SELECT id FROM companies WHERE corp_code = ?)",
                    code);
            jdbc.update("DELETE FROM companies WHERE corp_code = ?", code);
        }
        for (String runId : runIds) {
            jdbc.update("DELETE FROM company_card_imports WHERE run_id = ?", runId);
        }
    }

    @Test
    void firstRunInsertsCompaniesAliasesAndCurrentCards() {
        publish(
                entry(SDS, "삼성에스디에스", card(SDS, "v1"), "삼성에스디에스", "삼성sds"),
                entry(KAKAO, "카카오", card(KAKAO, "v1"), "카카오", "kakao"));

        ImportResult result = importer.importLatest().orElseThrow();

        assertThat(result.companies()).isEqualTo(2);
        assertThat(result.imported()).isEqualTo(2);
        assertThat(result.failed()).isZero();
        assertThat(aliasesOf(SDS)).containsExactlyInAnyOrder("삼성에스디에스", "삼성sds");
        assertThat(currentCard(SDS)).containsEntry("name", "v1").containsEntry("corp_code", SDS);
        assertThat(recorded(result.runId())).isTrue();
    }

    @Test
    void sameRunIsNotImportedTwice() {
        publish(entry(SDS, "삼성에스디에스", card(SDS, "v1"), "삼성sds"));
        importer.importLatest().orElseThrow();
        clearInvocations(source);

        assertThat(importer.importLatest()).isEmpty();
        verify(source, never()).read(startsWith("cards/"));
    }

    @Test
    void newRunReadsOnlyChangedCardsAndKeepsOneCurrent() {
        byte[] sdsV1 = card(SDS, "v1");
        publish(entry(SDS, "삼성에스디에스", sdsV1, "삼성sds"), entry(KAKAO, "카카오", card(KAKAO, "v1")));
        importer.importLatest().orElseThrow();

        // 다음 날: 카카오만 최근 이슈가 바뀌고, 삼성에스디에스는 별칭 하나가 바뀐다
        byte[] kakaoV2 = card(KAKAO, "v2");
        publish(entry(SDS, "삼성에스디에스", sdsV1, "sds"), entry(KAKAO, "카카오", kakaoV2));
        clearInvocations(source);

        ImportResult result = importer.importLatest().orElseThrow();

        assertThat(result.imported()).isEqualTo(1);
        verify(source, never()).read(key(SDS, sdsV1));
        assertThat(currentCard(KAKAO)).containsEntry("name", "v2");
        assertThat(cardCount(KAKAO)).isEqualTo(2); // 지난 카드는 보관 기간 동안 남는다
        assertThat(aliasesOf(SDS)).containsExactly("sds");
    }

    @Test
    void cardWithWrongHashFailsAndRunIsRetriedLater() {
        publish(entry(SDS, "삼성에스디에스", card(SDS, "v1")), entry(KAKAO, "카카오", card(KAKAO, "v1")));
        // 올라오는 도중이거나 깨진 파일: manifest 해시와 내용이 다르다
        when(source.read(key(KAKAO, card(KAKAO, "v1"))))
                .thenReturn(Optional.of("{\"broken\": true}".getBytes(StandardCharsets.UTF_8)));

        ImportResult result = importer.importLatest().orElseThrow();

        assertThat(result.imported()).isEqualTo(1);
        assertThat(result.failed()).isEqualTo(1);
        assertThat(currentCard(KAKAO)).isNull();
        assertThat(recorded(result.runId())).isFalse(); // 다음 주기에 다시 한다
    }

    @Test
    void aliasOwnedByAnotherCompanyIsSkipped() {
        publish(
                entry(SDS, "삼성에스디에스", card(SDS, "v1"), "같은이름"),
                entry(KAKAO, "카카오", card(KAKAO, "v1"), "같은이름", "카카오"));

        ImportResult result = importer.importLatest().orElseThrow();

        assertThat(result.failed()).isZero();
        assertThat(aliasesOf(SDS)).containsExactly("같은이름");
        assertThat(aliasesOf(KAKAO)).containsExactly("카카오");
    }

    @Test
    void staleCardsAreDeletedUnlessAnInterviewUsesThem() {
        publish(entry(SDS, "삼성에스디에스", card(SDS, "v1")));
        importer.importLatest().orElseThrow();
        long usedByInterview = currentCardId(SDS);
        publish(entry(SDS, "삼성에스디에스", card(SDS, "v2")));
        importer.importLatest().orElseThrow();
        long unused = currentCardId(SDS);
        publish(entry(SDS, "삼성에스디에스", card(SDS, "v3")));
        importer.importLatest().orElseThrow();
        // v1·v2 모두 보관 기간(30일)이 지났고, v1은 면접이 쓰고 있다
        jdbc.update(
                "UPDATE company_cards SET created_at = now() - interval '31 days' WHERE id IN (?,"
                        + " ?)",
                usedByInterview,
                unused);
        interviewUsing(usedByInterview);
        publish(entry(SDS, "삼성에스디에스", card(SDS, "v3")));

        ImportResult result = importer.importLatest().orElseThrow();

        assertThat(result.removed()).isEqualTo(1);
        assertThat(cardExists(usedByInterview)).isTrue();
        assertThat(cardExists(unused)).isFalse();
        assertThat(currentCard(SDS)).containsEntry("name", "v3");
    }

    @Test
    void unknownFormatIsNotImported() {
        String runId = "test-" + UUID.randomUUID();
        Map<String, Object> manifest = Map.of("format", 2, "run_id", runId, "companies", List.of());
        when(source.read(CompanyCardSource.MANIFEST))
                .thenReturn(Optional.of(JSON.writeValueAsBytes(manifest)));

        assertThat(importer.importLatest()).isEmpty();
        assertThat(recorded(runId)).isFalse();
    }

    /** 카드 파일들과 manifest를 가짜 버킷에 둔다. 실행마다 run_id가 다르다 */
    @SafeVarargs
    private void publish(Map<String, Object>... entries) {
        String runId = "test-" + UUID.randomUUID();
        runIds.add(runId);
        Map<String, Object> manifest =
                Map.of("format", 1, "run_id", runId, "companies", List.of(entries));
        files.put(CompanyCardSource.MANIFEST, JSON.writeValueAsBytes(manifest));
        when(source.read(anyString()))
                .thenAnswer(call -> Optional.ofNullable(files.get((String) call.getArgument(0))));
    }

    private Map<String, Object> entry(String code, String name, byte[] card, String... aliases) {
        String key = key(code, card);
        files.put(key, card);
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("corp_code", code);
        entry.put("name", name);
        entry.put("is_listed", true);
        entry.put("aliases", List.of(aliases));
        entry.put("generated_at", "2026-10-30");
        entry.put("card_key", key);
        entry.put("sha256", sha256(card));
        return entry;
    }

    /** 파이프라인 카드 모양. name 칸으로 버전을 구분한다 */
    private static byte[] card(String code, String version) {
        return JSON.writeValueAsBytes(
                Map.of("corp_code", code, "name", version, "talent", List.of(), "report", "r"));
    }

    private static String key(String code, byte[] card) {
        return "cards/" + code + "/" + sha256(card) + ".json";
    }

    private static String sha256(byte[] body) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private List<String> aliasesOf(String code) {
        return jdbc.queryForList(
                "SELECT a.alias FROM company_aliases a JOIN companies c ON c.id = a.company_id"
                        + " WHERE c.corp_code = ?",
                String.class,
                code);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> currentCard(String code) {
        List<String> found =
                jdbc.queryForList(
                        "SELECT k.card::text FROM company_cards k JOIN companies c"
                                + " ON c.id = k.company_id WHERE c.corp_code = ? AND k.is_current",
                        String.class,
                        code);
        return found.isEmpty() ? null : JSON.readValue(found.getFirst(), Map.class);
    }

    private long currentCardId(String code) {
        return jdbc.queryForObject(
                "SELECT k.id FROM company_cards k JOIN companies c ON c.id = k.company_id"
                        + " WHERE c.corp_code = ? AND k.is_current",
                Long.class,
                code);
    }

    private int cardCount(String code) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM company_cards k JOIN companies c ON c.id = k.company_id"
                        + " WHERE c.corp_code = ?",
                Integer.class,
                code);
    }

    private boolean cardExists(long id) {
        return jdbc.queryForObject(
                        "SELECT count(*) FROM company_cards WHERE id = ?", Integer.class, id)
                == 1;
    }

    private boolean recorded(String runId) {
        return jdbc.queryForObject(
                        "SELECT count(*) FROM company_card_imports WHERE run_id = ?",
                        Integer.class,
                        runId)
                == 1;
    }

    private void interviewUsing(long cardId) {
        long userId =
                jdbc.queryForObject(
                        "INSERT INTO users (email, password_hash, nickname, created_at, updated_at)"
                                + " VALUES (?, 'hash', 'card', now(), now()) RETURNING id",
                        Long.class,
                        "card-" + UUID.randomUUID() + "@ssafy.com");
        userIds.add(userId);
        long applicationId =
                jdbc.queryForObject(
                        "INSERT INTO applications (user_id, company_name, job_title, created_at)"
                                + " VALUES (?, '삼성 SDS', '백엔드', now()) RETURNING id",
                        Long.class,
                        userId);
        jdbc.update(
                "INSERT INTO interview_sessions (user_id, application_id, persona, mode, status,"
                        + " created_at, company_card_id) VALUES (?, ?, 'FRIENDLY', 'TEXT',"
                        + " 'COMPLETED', now(), ?)",
                userId,
                applicationId,
                cardId);
    }
}
