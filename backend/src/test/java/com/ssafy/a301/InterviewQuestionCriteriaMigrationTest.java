package com.ssafy.a301;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * V18 Migration이 이미 있는 질문 행의 채점 기준을 그 면접 플랜의 같은 seq 기준으로 채우는지 확인한다. 테스트 DB에 임시 스키마를 만들어 V17까지 올린 뒤
 * 데이터를 넣고 V18을 적용한다. 애플리케이션 스키마와 커넥션 풀은 건드리지 않고, 끝나면 임시 스키마를 지운다.
 */
@SpringBootTest
class InterviewQuestionCriteriaMigrationTest {
    private final String schema = "v17_it_" + UUID.randomUUID().toString().replace("-", "");

    @Value("${spring.datasource.url}")
    private String url;

    @Value("${spring.datasource.username}")
    private String username;

    @Value("${spring.datasource.password}")
    private String password;

    @AfterEach
    void dropSchema() {
        jdbc().execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    }

    @Test
    void existingQuestionsGetCriteriaOfTheirOwnPlan() {
        migrate("17");
        JdbcTemplate jdbc = jdbc();
        long userId =
                jdbc.queryForObject(
                        "INSERT INTO "
                                + schema
                                + ".users (email, password_hash, nickname, created_at, updated_at)"
                                + " VALUES ('migration@ssafy.com', 'hash', 'a', now(), now())"
                                + " RETURNING id",
                        Long.class);
        long applicationId =
                jdbc.queryForObject(
                        "INSERT INTO "
                                + schema
                                + ".applications (user_id, company_name, job_title, created_at)"
                                + " VALUES (?, '○○전자', '백엔드 개발자', now()) RETURNING id",
                        Long.class,
                        userId);
        long first = session(jdbc, userId, applicationId);
        long second = session(jdbc, userId, applicationId);
        long noPlan = session(jdbc, userId, applicationId);
        plan(jdbc, first, "A");
        plan(jdbc, second, "B");
        long firstQ1 = question(jdbc, first, 1);
        long firstQ2 = question(jdbc, first, 2);
        long secondQ2 = question(jdbc, second, 2);
        long noPlanQ1 = question(jdbc, noPlan, 1);

        migrate("18");

        // 같은 seq라도 면접마다 자기 플랜의 기준으로 채운다. 플랜이 없으면 null로 남는다
        assertThat(criteria(jdbc))
                .containsExactlyInAnyOrderEntriesOf(
                        nullable(
                                Map.of(firstQ1, "A기준1", firstQ2, "A기준2", secondQ2, "B기준2"),
                                noPlanQ1));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM "
                                        + schema
                                        + ".interview_questions WHERE prompt_version IS NOT NULL"
                                        + " OR model_version IS NOT NULL",
                                Integer.class))
                .isZero();
    }

    private long session(JdbcTemplate jdbc, long userId, long applicationId) {
        return jdbc.queryForObject(
                "INSERT INTO "
                        + schema
                        + ".interview_sessions (user_id, application_id, persona, mode, status,"
                        + " created_at) VALUES (?, ?, 'DEVIL', 'CHAT', 'COMPLETED', now())"
                        + " RETURNING id",
                Long.class,
                userId,
                applicationId);
    }

    // AI 명세 2장 형식. 질문 글은 플랜마다 같고 채점 기준만 다르게 둔다
    private void plan(JdbcTemplate jdbc, long sessionId, String prefix) {
        StringBuilder questions = new StringBuilder("[");
        for (int seq = 1; seq <= 5; seq++) {
            questions
                    .append(seq == 1 ? "" : ",")
                    .append("{\"seq\":")
                    .append(seq)
                    .append(",\"content\":\"질문")
                    .append(seq)
                    .append("\",\"criteria\":\"")
                    .append(prefix)
                    .append("기준")
                    .append(seq)
                    .append("\",\"claimId\":\"c1\"}");
        }
        jdbc.update(
                "INSERT INTO "
                        + schema
                        + ".interview_plans (session_id, claims, questions, prompt_version,"
                        + " model_version, created_at) VALUES (?, '[]', CAST(? AS jsonb),"
                        + " 'plan-v1', 'gms-test', now())",
                sessionId,
                questions.append("]").toString());
    }

    private long question(JdbcTemplate jdbc, long sessionId, int seq) {
        return jdbc.queryForObject(
                "INSERT INTO "
                        + schema
                        + ".interview_questions (session_id, seq, content, created_at)"
                        + " VALUES (?, ?, ?, now()) RETURNING id",
                Long.class,
                sessionId,
                seq,
                "질문" + seq);
    }

    private Map<Long, String> criteria(JdbcTemplate jdbc) {
        Map<Long, String> criteria = new HashMap<>();
        jdbc.query(
                "SELECT id, criteria FROM " + schema + ".interview_questions",
                row -> {
                    criteria.put(row.getLong("id"), row.getString("criteria"));
                });
        return criteria;
    }

    private static Map<Long, String> nullable(Map<Long, String> filled, long nullId) {
        Map<Long, String> expected = new HashMap<>(filled);
        expected.put(nullId, null);
        return expected;
    }

    private void migrate(String target) {
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(schema)
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private JdbcTemplate jdbc() {
        return new JdbcTemplate(new DriverManagerDataSource(url, username, password));
    }
}
