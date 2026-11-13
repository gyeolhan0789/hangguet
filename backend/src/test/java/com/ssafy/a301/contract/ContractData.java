package com.ssafy.a301.contract;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

/** 계약 검증이 상호작용마다 만든 데이터. 로컬 공용 DB에 남아 다음 실행 · 다른 통합 테스트에 섞이지 않게 지운다. */
final class ContractData {
    final List<Long> users = new ArrayList<>();

    /** 재생된 요청(회원가입 · 소셜 회원가입)이 만든 회원 */
    final List<String> emails = new ArrayList<>();

    final List<Long> notices = new ArrayList<>();
    final List<Long> admins = new ArrayList<>();

    /** 상황이 넣은 회사의 고유번호. 실제 DART 고유번호와 겹치지 않게 9로 시작한다 */
    static final String CORP_CODE = "99000363";

    /** 계약의 비회원 문의 이메일. 상황과 재생된 요청(9.1 비회원 문의 작성)이 만든 비회원 문의를 이 이메일로 찾아 지운다. */
    static final String GUEST_EMAIL = "a@ssafy.com";

    /** 이 상호작용을 시작한 때. 로컬 DB에 개발자가 같은 이메일로 넣은 비회원 문의는 지우지 않는다. */
    private final OffsetDateTime since = OffsetDateTime.now().minusSeconds(1);

    void delete(JdbcTemplate jdbc) {
        for (String email : emails) {
            users.addAll(
                    jdbc.queryForList("SELECT id FROM users WHERE email = ?", Long.class, email));
        }
        deleteGroups(jdbc);
        users.forEach(id -> deleteUser(jdbc, id));
        String guestInquiries =
                "SELECT id FROM inquiries WHERE user_id IS NULL AND email = ? AND created_at >= ?";
        jdbc.update(
                "DELETE FROM inquiry_attachments WHERE message_id IN (SELECT id FROM"
                        + " inquiry_messages WHERE inquiry_id IN ("
                        + guestInquiries
                        + "))",
                GUEST_EMAIL,
                since);
        jdbc.update(
                "DELETE FROM inquiry_messages WHERE inquiry_id IN (" + guestInquiries + ")",
                GUEST_EMAIL,
                since);
        jdbc.update(
                "DELETE FROM inquiries WHERE user_id IS NULL AND email = ? AND created_at >= ?",
                GUEST_EMAIL,
                since);
        for (long id : notices) {
            jdbc.update("DELETE FROM notices WHERE id = ?", id);
        }
        for (long id : admins) {
            jdbc.update("DELETE FROM streak_freeze_grants WHERE admin_id = ?", id);
            jdbc.update("DELETE FROM admins WHERE id = ?", id);
        }
        String company = "SELECT id FROM companies WHERE corp_code = '" + CORP_CODE + "'";
        jdbc.update("DELETE FROM company_cards WHERE company_id IN (" + company + ")");
        jdbc.update("DELETE FROM company_aliases WHERE company_id IN (" + company + ")");
        jdbc.update("DELETE FROM companies WHERE corp_code = ?", CORP_CODE);
    }

    /**
     * 그룹 면접(10장)은 회원 여럿의 면접을 묶어 회원마다 지우기 전에 먼저 푼다: 그룹의 지금 차례 → 참가자 → 면접의 그룹 → 그룹(방장) 순서. 방장이
     * 바뀌었어도(대기실 방장 넘김) 상황이 만든 회원끼리의 그룹이라 모두 지워진다.
     */
    private void deleteGroups(JdbcTemplate jdbc) {
        for (long id : users) {
            jdbc.update(
                    "UPDATE interview_groups SET turn_session_id = NULL WHERE host_user_id = ?",
                    id);
            jdbc.update("DELETE FROM interview_group_participants WHERE user_id = ?", id);
            jdbc.update("UPDATE interview_sessions SET group_id = NULL WHERE user_id = ?", id);
        }
        for (long id : users) {
            jdbc.update("DELETE FROM interview_groups WHERE host_user_id = ?", id);
        }
    }

    /** 회원과 회원이 만든 데이터를 외래키 순서대로 지운다. */
    private static void deleteUser(JdbcTemplate jdbc, long id) {
        String sessions = "SELECT id FROM interview_sessions WHERE user_id = " + id;
        String questions =
                "SELECT id FROM interview_questions WHERE session_id IN (" + sessions + ")";
        String inquiries = "SELECT id FROM inquiries WHERE user_id = " + id;
        jdbc.update("DELETE FROM recordings WHERE session_id IN (" + sessions + ")");
        jdbc.update("DELETE FROM answers WHERE question_id IN (" + questions + ")");
        jdbc.update("DELETE FROM interview_questions WHERE session_id IN (" + sessions + ")");
        for (String table :
                List.of("interview_plans", "session_scores", "speech_metrics", "ai_job_outbox")) {
            jdbc.update("DELETE FROM " + table + " WHERE session_id IN (" + sessions + ")");
        }
        jdbc.update("DELETE FROM password_changes WHERE user_id = ?", id);
        jdbc.update(
                "DELETE FROM inquiry_attachments WHERE message_id IN (SELECT id FROM"
                        + " inquiry_messages WHERE inquiry_id IN ("
                        + inquiries
                        + "))");
        jdbc.update("DELETE FROM inquiry_messages WHERE inquiry_id IN (" + inquiries + ")");
        // 지원서 주장 · 질문 보관함 · 주장 추출 작업은 면접이 아니라 지원서를 가리킨다
        for (String table : List.of("ai_job_outbox", "application_claims", "question_pool_items")) {
            jdbc.update(
                    "DELETE FROM "
                            + table
                            + " WHERE application_id IN (SELECT id FROM applications WHERE user_id"
                            + " = ?)",
                    id);
        }
        jdbc.update(
                "DELETE FROM cover_letter_items WHERE application_id IN (SELECT id FROM"
                        + " applications WHERE user_id = ?)",
                id);
        for (String table :
                List.of(
                        "inquiries",
                        "practice_logs",
                        "interview_sessions",
                        "applications",
                        "notice_reads",
                        "streak_freezes",
                        "streak_freeze_grant_targets",
                        "user_agreements",
                        "user_social_accounts",
                        "practice_alarms")) {
            jdbc.update("DELETE FROM " + table + " WHERE user_id = ?", id);
        }
        jdbc.update("DELETE FROM users WHERE id = ?", id);
    }
}
