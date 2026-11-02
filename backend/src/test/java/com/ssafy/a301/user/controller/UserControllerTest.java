package com.ssafy.a301.user.controller;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.dto.UserDtos.MeResponse;
import com.ssafy.a301.user.dto.UserDtos.NicknameChangeResponse;
import com.ssafy.a301.user.dto.UserDtos.PasswordChangeResponse;
import com.ssafy.a301.user.dto.UserDtos.UploadUrlResponse;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.service.PasswordChangeService;
import com.ssafy.a301.user.service.UserService;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@WebMvcTest(UserController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class UserControllerTest {
    private static final RequestPostProcessor USER_7 = jwt().jwt(token -> token.subject("7"));

    @Autowired private MockMvc mvc;
    @MockitoBean private UserService service;
    @MockitoBean private PasswordChangeService passwordChanges;
    @MockitoBean private UserRepository users;

    @Test
    void everyApiRequiresAuthentication() throws Exception {
        for (MockHttpServletRequestBuilder request :
                new MockHttpServletRequestBuilder[] {
                    get("/api/v1/users/me"),
                    patch("/api/v1/users/me"),
                    patch("/api/v1/users/me/password"),
                    post("/api/v1/users/me/profile-image/upload-url"),
                    put("/api/v1/users/me/profile-image"),
                    delete("/api/v1/users/me/profile-image"),
                    post("/api/v1/users/me")
                }) {
            mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        }
    }

    @Test
    void dateTimeHasKoreanOffset() throws Exception {
        when(service.me(7L))
                .thenReturn(
                        new MeResponse(
                                7L,
                                "a@test.com",
                                "면접왕",
                                null,
                                null,
                                null,
                                OffsetDateTime.parse("2026-09-01T01:00:00Z"),
                                0));
        mvc.perform(get("/api/v1/users/me").with(USER_7))
                .andExpect(jsonPath("$.createdAt").value("2026-09-01T10:00:00+09:00"));
    }

    @Test
    void meUsesAuthenticatedUser() throws Exception {
        when(service.me(7L))
                .thenReturn(new MeResponse(7L, "a@test.com", "면접왕", null, null, null, null, 3));
        mvc.perform(get("/api/v1/users/me").with(USER_7))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(7))
                .andExpect(jsonPath("$.currentStreak").value(3));
    }

    @Test
    void nicknameChangeReturnsNewAccessToken() throws Exception {
        when(service.changeNickname(7L, "새닉네임"))
                .thenReturn(
                        new NicknameChangeResponse(
                                7L,
                                "a@test.com",
                                "새닉네임",
                                null,
                                null,
                                null,
                                null,
                                0,
                                "new-access",
                                3600));
        mvc.perform(json(patch("/api/v1/users/me"), "{\"nickname\":\"새닉네임\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nickname").value("새닉네임"))
                .andExpect(jsonPath("$.accessToken").value("new-access"))
                .andExpect(jsonPath("$.expiresIn").value(3600));
    }

    @Test
    void blankNicknameIsValidationError() throws Exception {
        mvc.perform(json(patch("/api/v1/users/me"), "{\"nickname\":\" \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void passwordChangeReturnsNewTokens() throws Exception {
        when(passwordChanges.changeByUser(7L, "abcd1234", "efgh5678"))
                .thenReturn(new PasswordChangeResponse("new-access", "new-refresh", 3600));
        mvc.perform(
                        json(
                                patch("/api/v1/users/me/password"),
                                "{\"currentPassword\":\"abcd1234\",\"newPassword\":\"efgh5678\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("new-access"))
                .andExpect(jsonPath("$.refreshToken").value("new-refresh"))
                .andExpect(jsonPath("$.expiresIn").value(3600));
    }

    @Test
    void wrongCurrentPasswordIsPasswordMismatch() throws Exception {
        doThrow(new ApiException(ErrorCode.PASSWORD_MISMATCH))
                .when(passwordChanges)
                .changeByUser(7L, "wrong123", "efgh5678");
        mvc.perform(
                        json(
                                patch("/api/v1/users/me/password"),
                                "{\"currentPassword\":\"wrong123\",\"newPassword\":\"efgh5678\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PASSWORD_MISMATCH"));
    }

    @Test
    void weakNewPasswordIsValidationError() throws Exception {
        mvc.perform(
                        json(
                                patch("/api/v1/users/me/password"),
                                "{\"currentPassword\":\"abcd1234\",\"newPassword\":\"onlyletters\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("newPassword"));
        verify(passwordChanges, never()).changeByUser(anyLong(), anyString(), anyString());
    }

    @Test
    void uploadUrlIsIssued() throws Exception {
        when(service.profileImageUploadUrl(7L, "image/png", 204800L))
                .thenReturn(
                        new UploadUrlResponse(
                                "https://s3/put", "profile/7/a.png", OffsetDateTime.now()));
        mvc.perform(
                        json(
                                post("/api/v1/users/me/profile-image/upload-url"),
                                "{\"contentType\":\"image/png\",\"size\":204800}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.objectKey").value("profile/7/a.png"));
    }

    @Test
    void unsupportedTypeOrTooLargeFileIsRejected() throws Exception {
        mvc.perform(
                        json(
                                post("/api/v1/users/me/profile-image/upload-url"),
                                "{\"contentType\":\"image/gif\",\"size\":1024}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("contentType"));
        mvc.perform(
                        json(
                                post("/api/v1/users/me/profile-image/upload-url"),
                                "{\"contentType\":\"image/png\",\"size\":5242881}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("size"));
    }

    @Test
    void keyIssuedToSomeoneElseIsValidationError() throws Exception {
        when(service.registerProfileImage(7L, "profile/8/b.png"))
                .thenThrow(new FieldValidationException("objectKey", "본인에게 발급된 키가 아닙니다."));
        mvc.perform(
                        json(
                                put("/api/v1/users/me/profile-image"),
                                "{\"objectKey\":\"profile/8/b.png\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("objectKey"));
    }

    @Test
    void missingFileIsNotFound() throws Exception {
        when(service.registerProfileImage(7L, "profile/7/b.png"))
                .thenThrow(new ApiException(ErrorCode.FILE_NOT_FOUND));
        mvc.perform(
                        json(
                                put("/api/v1/users/me/profile-image"),
                                "{\"objectKey\":\"profile/7/b.png\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("FILE_NOT_FOUND"));
    }

    @Test
    void withdrawalIsNoContent() throws Exception {
        mvc.perform(json(post("/api/v1/users/me"), "{\"password\":\"abcd1234\"}"))
                .andExpect(status().isNoContent());
        verify(service).withdraw(7L, "abcd1234");
    }

    @Test
    void withdrawalWithWrongPasswordIsPasswordMismatch() throws Exception {
        doThrow(new ApiException(ErrorCode.PASSWORD_MISMATCH))
                .when(service)
                .withdraw(7L, "wrong123");
        mvc.perform(json(post("/api/v1/users/me"), "{\"password\":\"wrong123\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PASSWORD_MISMATCH"));
    }

    @Test
    void withdrawalWithoutPasswordIsCheckedByService() throws Exception {
        // 소셜 회원은 비밀번호를 보내지 않는다. 이메일 회원인지는 서비스가 확인한다
        mvc.perform(json(post("/api/v1/users/me"), "{}")).andExpect(status().isNoContent());
        verify(service).withdraw(7L, null);
    }

    @Test
    void tooLongWithdrawalPasswordIsValidationError() throws Exception {
        mvc.perform(json(post("/api/v1/users/me"), "{\"password\":\"" + "a1".repeat(32) + "b\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("password"));
        verify(service, never()).withdraw(anyLong(), anyString());
    }

    @Test
    void profileImageDeletionIsNoContent() throws Exception {
        mvc.perform(delete("/api/v1/users/me/profile-image").with(USER_7))
                .andExpect(status().isNoContent());
        verify(service).deleteProfileImage(7L);
    }

    private static MockHttpServletRequestBuilder json(
            MockHttpServletRequestBuilder request, String body) {
        return request.with(USER_7).contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
