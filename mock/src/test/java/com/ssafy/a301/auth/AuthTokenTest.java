package com.ssafy.a301.auth;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 회원가입·로그인·재발급·닉네임 변경·비밀번호 변경이 회원 id와 닉네임을 담은 JWT를 주는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class AuthTokenTest {

    @Autowired private MockMvcTester mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void signupTokenHasRequestNickname() throws Exception {
        String body =
                """
                { "email": "b@ssafy.com", "password": "abcd1234", "nickname": " 새회원 ",
                  "agreements": [ { "termsType": "TERMS", "termsVersion": "1.0" },
                                  { "termsType": "PRIVACY", "termsVersion": "1.0" },
                                  { "termsType": "RECORDING", "termsVersion": "1.0" } ] }\
                """;
        JsonNode response = post("/api/v1/auth/signup", body);
        JsonNode claims = claims(response.get("accessToken").asString());

        assertThat(claims.get("sub").asString()).isEqualTo("1");
        assertThat(claims.get("nickname").asString()).isEqualTo("새회원");
        assertThat(claims.get("exp").asLong() - claims.get("iat").asLong())
                .isEqualTo(response.get("expiresIn").asLong());
        assertThat(response.get("user").get("nickname").asString()).isEqualTo("새회원");
    }

    @Test
    void loginAndRefreshTokensHaveExampleNickname() throws Exception {
        JsonNode login =
                post(
                        "/api/v1/auth/login",
                        "{ \"email\": \"a@ssafy.com\", \"password\": \"abcd1234\" }");
        JsonNode refresh =
                post(
                        "/api/v1/auth/token/refresh",
                        "{ \"refreshToken\": \"" + login.get("refreshToken").asString() + "\" }");

        assertThat(claims(login.get("accessToken").asString()).get("nickname").asString())
                .isEqualTo("면접왕");
        assertThat(claims(refresh.get("accessToken").asString()).get("nickname").asString())
                .isEqualTo("면접왕");
        assertThat(refresh.get("refreshToken").asString())
                .isNotEqualTo(login.get("refreshToken").asString());
    }

    @Test
    void nicknameChangeReturnsTokenWithNewNickname() throws Exception {
        MvcTestResult result =
                mockMvc.patch()
                        .uri("/api/v1/users/me")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{ \"nickname\": \" 새닉네임 \" }")
                        .exchange();
        assertThat(result).hasStatusOk();
        JsonNode response = objectMapper.readTree(result.getResponse().getContentAsString(UTF_8));

        assertThat(response.get("nickname").asString()).isEqualTo("새닉네임");
        assertThat(claims(response.get("accessToken").asString()).get("nickname").asString())
                .isEqualTo("새닉네임");
        assertThat(response.get("expiresIn").asLong()).isPositive();
    }

    @Test
    void passwordChangeReturnsNewTokens() throws Exception {
        MvcTestResult result =
                mockMvc.patch()
                        .uri("/api/v1/users/me/password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                "{ \"currentPassword\": \"abcd1234\", \"newPassword\":"
                                        + " \"efgh5678\" }")
                        .exchange();
        assertThat(result).hasStatusOk();
        JsonNode response = objectMapper.readTree(result.getResponse().getContentAsString(UTF_8));

        assertThat(claims(response.get("accessToken").asString()).get("sub").asString())
                .isEqualTo("1");
        assertThat(response.get("refreshToken").asString()).isNotBlank();
        assertThat(response.get("expiresIn").asLong()).isPositive();
    }

    private JsonNode post(String uri, String body) throws Exception {
        MvcTestResult result =
                mockMvc.post()
                        .uri(uri)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body)
                        .exchange();
        assertThat(result).hasStatus2xxSuccessful();
        return objectMapper.readTree(result.getResponse().getContentAsString(UTF_8));
    }

    private JsonNode claims(String jwt) {
        String[] parts = jwt.split("\\.");
        assertThat(parts).hasSize(3);
        return objectMapper.readTree(Base64.getUrlDecoder().decode(parts[1]));
    }
}
