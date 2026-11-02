package com.ssafy.a301.alarm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.KakaoIntegrationTest;
import com.ssafy.a301.alarm.domain.PracticeAlarm;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoConsent;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoToken;
import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.service.UserService;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** 2.8 ~ 2.11 연습 알림과 보낼 회원 조회. 카카오 API는 가짜로 둔다. */
class PracticeAlarmIntegrationTest extends KakaoIntegrationTest {
    private static final String REDIRECT = "https://a301/oauth/kakao/callback";
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 20);
    private static final LocalTime TIME = LocalTime.of(22, 30);

    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;
    @Autowired private PracticeAlarmRepository alarms;
    @Autowired private UserService users;

    @Test
    void kakaoUserTurnsOnChangesTimeAndTurnsOff() throws Exception {
        User user = kakaoUser("12345");
        givenKakaoConsent("12345", true);

        mvc.perform(get("/api/v1/users/me/practice-alarm").with(as(user)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true))
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.time").value("21:00"));
        mvc.perform(
                        put("/api/v1/users/me/practice-alarm")
                                .with(as(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\"code\",\"redirectUri\":\"" + REDIRECT + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.time").value("21:00"));
        mvc.perform(
                        patch("/api/v1/users/me/practice-alarm")
                                .with(as(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"time\":\"22:30\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.time").value("22:30"));
        em.flush();
        em.clear();

        // 토큰은 암호화해 저장하고 읽을 때 푼다
        PracticeAlarm saved = alarms.findById(user.getId()).orElseThrow();
        assertThat(saved.getKakaoAccessToken()).isEqualTo("kakao-access");
        assertThat(saved.getKakaoRefreshToken()).isEqualTo("kakao-refresh");
        Object stored =
                em.createNativeQuery(
                                "select kakao_refresh_token from practice_alarms where user_id = ?")
                        .setParameter(1, user.getId())
                        .getSingleResult();
        assertThat(stored).isNotEqualTo("kakao-refresh");

        mvc.perform(delete("/api/v1/users/me/practice-alarm").with(as(user)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/users/me/practice-alarm").with(as(user)))
                .andExpect(jsonPath("$.enabled").value(false))
                .andExpect(jsonPath("$.time").value("22:30"));
    }

    @Test
    void needsLoginAndValidTime() throws Exception {
        mvc.perform(get("/api/v1/users/me/practice-alarm")).andExpect(status().isUnauthorized());
        User user = kakaoUser("12345");
        for (String time : new String[] {"24:00", "9:30", "21:00:00", ""}) {
            mvc.perform(
                            patch("/api/v1/users/me/practice-alarm")
                                    .with(as(user))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"time\":\"" + time + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        }
    }

    @Test
    void otherKakaoAccountOrNoConsentIsRejected() throws Exception {
        User user = kakaoUser("12345");

        givenKakaoConsent("99999", true);
        enable(user)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("KAKAO_ACCOUNT_MISMATCH"));
        givenKakaoConsent("12345", false);
        enable(user)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("KAKAO_MESSAGE_CONSENT_REQUIRED"));

        assertThat(alarms.findById(user.getId())).isEmpty();
    }

    @Test
    void emailAndGoogleUsersCannotUseAlarm() throws Exception {
        User email = user();
        User google = user();
        em.persist(new UserSocialAccount(google, SocialProvider.GOOGLE, "g-1"));

        for (User other : new User[] {email, google}) {
            mvc.perform(get("/api/v1/users/me/practice-alarm").with(as(other)))
                    .andExpect(jsonPath("$.available").value(false));
            enable(other)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("PRACTICE_ALARM_UNAVAILABLE"));
            mvc.perform(
                            patch("/api/v1/users/me/practice-alarm")
                                    .with(as(other))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"time\":\"22:30\"}"))
                    .andExpect(status().isConflict());
        }
    }

    @Test
    void dueUsersAreEnabledActiveNotSentAndNotPracticedToday() {
        User due = enabledUser(TIME);
        User earlierInWindow = enabledUser(LocalTime.of(22, 20));
        enabledUser(LocalTime.of(22, 19));
        enabledUser(LocalTime.of(22, 31));
        User practiced = enabledUser(TIME);
        em.persist(new PracticeLog(practiced, TODAY));
        User practicedYesterday = enabledUser(TIME);
        em.persist(new PracticeLog(practicedYesterday, TODAY.minusDays(1)));
        User sent = enabledUser(TIME);
        alarms.claimToday(sent.getId(), TODAY);
        User off = enabledUser(TIME);
        alarms.findById(off.getId()).orElseThrow().disable();
        User withdrawn = enabledUser(TIME);
        withdrawn.withdraw(OffsetDateTime.now());
        em.flush();

        assertThat(alarms.findDueUserIds(LocalTime.of(22, 20), TIME, TODAY))
                .containsExactlyInAnyOrder(
                        due.getId(), earlierInWindow.getId(), practicedYesterday.getId());
        assertThat(alarms.claimToday(due.getId(), TODAY)).isEqualTo(1);
        assertThat(alarms.claimToday(due.getId(), TODAY)).isZero();
        assertThat(alarms.claimToday(due.getId(), TODAY.plusDays(1))).isEqualTo(1);
    }

    @Test
    void withdrawalDeletesAlarm() {
        User user = enabledUser(TIME);
        em.flush();

        users.withdraw(user.getId(), null);
        em.flush();
        em.clear();

        assertThat(alarms.findById(user.getId())).isEmpty();
    }

    @Test
    void accessAndRefreshTokensAreSetTogether() {
        User user = user();
        em.flush();

        assertThatThrownBy(
                        () ->
                                em.createNativeQuery(
                                                "insert into practice_alarms (user_id, alarm_time,"
                                                        + " kakao_access_token, created_at,"
                                                        + " updated_at) values (?, '21:00', 'x',"
                                                        + " now(), now())")
                                        .setParameter(1, user.getId())
                                        .executeUpdate())
                .hasStackTraceContaining("ck_practice_alarms_tokens");
    }

    private ResultActions enable(User user) throws Exception {
        return mvc.perform(
                put("/api/v1/users/me/practice-alarm")
                        .with(as(user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"code\",\"redirectUri\":\"" + REDIRECT + "\"}"));
    }

    private void givenKakaoConsent(String kakaoUserId, boolean agreed) {
        when(kakao.isConfigured()).thenReturn(true);
        when(kakao.isAllowedRedirectUri(REDIRECT)).thenReturn(true);
        when(kakao.exchange("code", REDIRECT))
                .thenReturn(new KakaoToken("kakao-access", 21_599L, "kakao-refresh", 5_183_999L));
        when(kakao.consent("kakao-access")).thenReturn(new KakaoConsent(kakaoUserId, agreed));
    }

    private User enabledUser(LocalTime time) {
        User user = kakaoUser(UUID.randomUUID().toString());
        PracticeAlarm alarm = new PracticeAlarm(user.getId());
        alarm.changeTime(time);
        OffsetDateTime later = OffsetDateTime.now().plusHours(6);
        alarm.enable("access", later, "refresh", later.plusDays(60));
        em.persist(alarm);
        return user;
    }

    private User kakaoUser(String kakaoUserId) {
        User user = User.social("alarm-" + UUID.randomUUID() + "@example.com", "카카오");
        em.persist(user);
        em.persist(new UserSocialAccount(user, SocialProvider.KAKAO, kakaoUserId));
        return user;
    }

    private User user() {
        User user = new User("alarm-" + UUID.randomUUID() + "@example.com", "hash", "이메일");
        em.persist(user);
        return user;
    }

    private static RequestPostProcessor as(User user) {
        return jwt().jwt(token -> token.subject(user.getId().toString()));
    }
}
