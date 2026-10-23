package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.AdminLoginRequest;
import com.ssafy.a301.admin.AdminDtos.AdminSummary;
import com.ssafy.a301.admin.AdminDtos.AdminTokenResponse;
import com.ssafy.a301.auth.JwtIssuer;
import com.ssafy.a301.common.ErrorExamples;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin/auth")
public class AdminAuthController {

    private static final String TOKEN_EXAMPLE =
            """
            { "accessToken": "eyJ…", "expiresIn": 3600,
              "admin": { "id": 1, "loginId": "admin", "name": "운영자" } }\
            """;

    // 목 서버는 관리자를 저장하지 않아 로그인은 이 예시 관리자로 토큰을 만든다
    private static final long EXAMPLE_ADMIN_ID = 1L;
    private static final String EXAMPLE_ADMIN_NAME = "운영자";

    private final JwtIssuer jwtIssuer;

    public AdminAuthController(JwtIssuer jwtIssuer) {
        this.jwtIssuer = jwtIssuer;
    }

    @Operation(
            summary = "8.1 관리자 로그인",
            description = "관리 페이지 로그인. 관리 API(`/api/v1/admin/**`)는 이 토큰으로 부른다.")
    @SecurityRequirements
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = TOKEN_EXAMPLE)))
    @ApiResponse(
            responseCode = "401",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "ADMIN_LOGIN_FAILED",
                                            value = ErrorExamples.ADMIN_LOGIN_FAILED)))
    @PostMapping("/login")
    public AdminTokenResponse login(@Valid @RequestBody AdminLoginRequest request) {
        return new AdminTokenResponse(
                jwtIssuer.issueAccessToken(EXAMPLE_ADMIN_ID, EXAMPLE_ADMIN_NAME),
                jwtIssuer.accessTokenTtlSeconds(),
                new AdminSummary(EXAMPLE_ADMIN_ID, request.loginId(), EXAMPLE_ADMIN_NAME));
    }

    @Operation(summary = "8.2 관리자 로그아웃")
    @ApiResponse(responseCode = "204")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout() {}
}
