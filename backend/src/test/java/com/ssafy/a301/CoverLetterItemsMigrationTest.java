package com.ssafy.a301;

import static org.assertj.core.api.Assertions.assertThat;

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
 * V13 Migration이 이미 있는 지원서의 자기소개서 글을 1번 문항으로 옮기는지 확인한다. 테스트 DB에 임시 스키마를 만들어 V12까지 올린 뒤 데이터를 넣고 V13을
 * 적용한다. 애플리케이션 스키마와 커넥션 풀은 건드리지 않고, 끝나면 임시 스키마를 지운다.
 */
@SpringBootTest
class CoverLetterItemsMigrationTest {
    private final String schema = "v12_it_" + UUID.randomUUID().toString().replace("-", "");

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
    void existingCoverLetterBecomesFirstItem() {
        migrate("12");
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
                                + ".applications (user_id, company_name, job_title, cover_letter,"
                                + " created_at) VALUES (?, '○○전자', '백엔드 개발자', ?, now())"
                                + " RETURNING id",
                        Long.class,
                        userId,
                        "A\nB");

        migrate("13");

        assertThat(
                        jdbc.queryForList(
                                "SELECT item_order, question, answer FROM "
                                        + schema
                                        + ".cover_letter_items WHERE application_id = ?",
                                applicationId))
                .containsExactly(Map.of("item_order", 1, "question", "자기소개서", "answer", "A\nB"));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT deleted_at IS NULL FROM "
                                        + schema
                                        + ".applications WHERE id = ?",
                                Boolean.class,
                                applicationId))
                .isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM information_schema.columns WHERE"
                                        + " table_schema = ? AND table_name = 'applications'"
                                        + " AND column_name = 'cover_letter'",
                                Integer.class,
                                schema))
                .isZero();
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
