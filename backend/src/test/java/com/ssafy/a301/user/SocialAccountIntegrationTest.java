package com.ssafy.a301.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.KakaoIntegrationTest;
import com.ssafy.a301.alarm.domain.PracticeAlarm;
import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.auth.oauth.SocialProfile;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import jakarta.persistence.EntityManager;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** 2.12 · 2.13 소셜 계정 연결 · 해제. 카카오 API는 가짜로 둔다. */
class SocialAccountIntegrationTest extends KakaoIntegrationTest {
    private static final String KAKAO = "/api/v1/users/me/social-accounts/kakao";
    private static final String REDIRECT = "https://a301/oauth/kakao/callback";
    private static final String BODY = "{\"code\":\"code\",\"redirectUri\":\"" + REDIRECT + "\"}";

    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;
    @Autowired private UserSocialAccountRepository socialAccounts;
    @Autowired private PracticeAlarmRepository alarms;

    @Test
    void emailUserLinksKakaoAndLogsInWithIt() throws Exception {
        User user = emailUser();
        givenKakaoUser("12345");

        link(user)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.socialProvider").doesNotExist())
                .andExpect(jsonPath("$.linkedProvider").value("KAKAO"));
        mvc.perform(get("/api/v1/users/me").with(as(user)))
                .andExpect(jsonPath("$.linkedProvider").value("KAKAO"));
        mvc.perform(get("/api/v1/users/me/practice-alarm").with(as(user)))
                .andExpect(jsonPath("$.available").value(true));

        // 이메일이 달라도 카카오 로그인(1.6)으로 같은 회원에 들어간다
        mvc.perform(
                        post("/api/v1/auth/oauth/kakao")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(BODY))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.signupRequired").value(false))
                .andExpect(jsonPath("$.token.user.id").value(user.getId()));
    }

    @Test
    void socialOrAlreadyLinkedUserCannotLinkBeforeCallingKakao() throws Exception {
        User social = kakaoUser("11111");
        User linked = emailUser();
        em.persist(new UserSocialAccount(linked, SocialProvider.KAKAO, "22222"));

        for (User user : new User[] {social, linked}) {
            link(user)
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("SOCIAL_ALREADY_LINKED"));
        }
        verify(kakaoLogin, never()).fetchProfile(any(), any());
    }

    @Test
    void kakaoAccountOfAnotherUserIsRejected() throws Exception {
        kakaoUser("12345");
        User user = emailUser();
        givenKakaoUser("12345");

        link(user)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SOCIAL_ACCOUNT_IN_USE"));
        assertThat(socialAccounts.findActiveByUserId(user.getId())).isEmpty();
    }

    @Test
    void unusableCodeIsBadRequestNotUnauthorized() throws Exception {
        User user = emailUser();
        doThrow(new ApiException(ErrorCode.SOCIAL_LOGIN_FAILED))
                .when(kakaoLogin)
                .fetchProfile("code", REDIRECT);

        link(user)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SOCIAL_LINK_FAILED"));
    }

    @Test
    void onlyKakaoIsSupported() throws Exception {
        User user = emailUser();

        mvc.perform(
                        put("/api/v1/users/me/social-accounts/google")
                                .with(as(user))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(BODY))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mvc.perform(delete("/api/v1/users/me/social-accounts/google").with(as(user)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void unlinkTurnsOffAlarmAndFreesKakaoAccount() throws Exception {
        User user = emailUser();
        em.persist(new UserSocialAccount(user, SocialProvider.KAKAO, "12345"));
        PracticeAlarm alarm = new PracticeAlarm(user.getId());
        alarm.changeTime(LocalTime.of(22, 30));
        OffsetDateTime later = OffsetDateTime.now().plusHours(6);
        alarm.enable("access", later, "refresh", later.plusDays(60));
        em.persist(alarm);
        em.flush();

        mvc.perform(delete(KAKAO).with(as(user))).andExpect(status().isNoContent());
        em.flush();
        em.clear();

        assertThat(socialAccounts.findActiveByUserId(user.getId())).isEmpty();
        PracticeAlarm off = alarms.findById(user.getId()).orElseThrow();
        assertThat(off.isEnabled()).isFalse();
        assertThat(off.getAlarmTime()).isEqualTo(LocalTime.of(22, 30));
        mvc.perform(get("/api/v1/users/me").with(as(user)))
                .andExpect(jsonPath("$.linkedProvider").doesNotExist());
        // 연결하지 않았어도 204
        mvc.perform(delete(KAKAO).with(as(user))).andExpect(status().isNoContent());

        // 끊은 카카오 계정은 다른 회원이 연결할 수 있다
        User other = emailUser();
        givenKakaoUser("12345");
        link(other).andExpect(status().isOk());
    }

    @Test
    void socialUserCannotUnlink() throws Exception {
        User social = kakaoUser("12345");

        mvc.perform(delete(KAKAO).with(as(social)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PASSWORD_NOT_SET"));
        assertThat(socialAccounts.findActiveByUserId(social.getId())).isPresent();
    }

    @Test
    void userHasAtMostOneActiveLinkInDb() {
        User user = emailUser();
        em.persist(new UserSocialAccount(user, SocialProvider.KAKAO, "12345"));
        em.flush();

        assertThatThrownBy(
                        () -> {
                            em.persist(new UserSocialAccount(user, SocialProvider.GOOGLE, "g-1"));
                            em.flush();
                        })
                .hasStackTraceContaining("uk_user_social_accounts_user_active");
    }

    @Test
    void needsLogin() throws Exception {
        mvc.perform(put(KAKAO).contentType(MediaType.APPLICATION_JSON).content(BODY))
                .andExpect(status().isUnauthorized());
        mvc.perform(delete(KAKAO)).andExpect(status().isUnauthorized());
    }

    private ResultActions link(User user) throws Exception {
        return mvc.perform(
                put(KAKAO).with(as(user)).contentType(MediaType.APPLICATION_JSON).content(BODY));
    }

    private void givenKakaoUser(String kakaoUserId) {
        doReturn(new SocialProfile(SocialProvider.KAKAO, kakaoUserId, "other@kakao.com", "카카오"))
                .when(kakaoLogin)
                .fetchProfile("code", REDIRECT);
    }

    private User kakaoUser(String kakaoUserId) {
        User user = User.social("link-" + UUID.randomUUID() + "@example.com", "카카오");
        em.persist(user);
        em.persist(new UserSocialAccount(user, SocialProvider.KAKAO, kakaoUserId));
        return user;
    }

    private User emailUser() {
        User user = new User("link-" + UUID.randomUUID() + "@example.com", "hash", "이메일");
        em.persist(user);
        return user;
    }

    private static RequestPostProcessor as(User user) {
        return jwt().jwt(token -> token.subject(user.getId().toString()));
    }
}
