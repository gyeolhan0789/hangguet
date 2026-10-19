package com.ssafy.a301.auth;

import com.ssafy.a301.auth.AuthDtos.EmailAvailabilityResponse;
import com.ssafy.a301.auth.AuthDtos.LoginRequest;
import com.ssafy.a301.auth.AuthDtos.LogoutRequest;
import com.ssafy.a301.auth.AuthDtos.RefreshRequest;
import com.ssafy.a301.auth.AuthDtos.RefreshResponse;
import com.ssafy.a301.auth.AuthDtos.SignupRequest;
import com.ssafy.a301.auth.AuthDtos.TokenResponse;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.UserDtos.UserSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;
import java.util.EnumSet;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "1. 인증")
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final String SIGNUP_EXAMPLE =
            """
            { "email": "a@ssafy.com", "password": "abcd1234", "nickname": "면접왕",
              "agreements": [ { "termsType": "TERMS", "termsVersion": "1.0" },
                              { "termsType": "PRIVACY", "termsVersion": "1.0" },
                              { "termsType": "RECORDING", "termsVersion": "1.0" } ] }\
            """;
    private static final String TOKEN_EXAMPLE =
            """
            { "accessToken": "eyJ…", "refreshToken": "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10", "expiresIn": 3600,
              "user": { "id": 1, "email": "a@ssafy.com", "nickname": "면접왕", "profileImageUrl": null } }\
            """;
    private static final String REFRESH_EXAMPLE =
            """
            { "accessToken": "eyJ…", "refreshToken": "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10", "expiresIn": 3600 }\
            """;

    // 목 서버는 회원을 저장하지 않아 로그인·재발급은 이 예시 회원으로 토큰을 만든다
    private static final long EXAMPLE_USER_ID = 1L;
    private static final String EXAMPLE_NICKNAME = "면접왕";

    private final JwtIssuer jwtIssuer;

    public AuthController(JwtIssuer jwtIssuer) {
        this.jwtIssuer = jwtIssuer;
    }

    @Operation(
            summary = "1.1 이메일 사용 가능 여부",
            description = "가입에 쓸 수 있는 이메일인지 확인한다. 이미 가입된 이메일이면 `available: false`를 준다.")
    @SecurityRequirements
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = "{ \"available\": true }")))
    @GetMapping("/email-availability")
    public EmailAvailabilityResponse emailAvailability(
            @Parameter(description = "확인할 이메일. 이메일 형식, 최대 255자", example = "a@ssafy.com")
                    @RequestParam
                    @Email(message = "이메일 형식이 아닙니다.")
                    @Size(max = 255, message = "최대 255자입니다.")
                    String email) {
        return new EmailAvailabilityResponse(true);
    }

    @Operation(summary = "1.2 회원가입", description = "회원을 만들고 로그인 토큰을 준다. 필수 약관 3개에 모두 동의해야 한다.")
    @SecurityRequirements
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content = @Content(examples = @ExampleObject(value = SIGNUP_EXAMPLE)))
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = TOKEN_EXAMPLE)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "AGREEMENT_REQUIRED",
                                        value = ErrorExamples.AGREEMENT_REQUIRED),
                                @ExampleObject(
                                        name = "VALIDATION_FAILED",
                                        value = ErrorExamples.VALIDATION_FAILED)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "EMAIL_DUPLICATED",
                                            value = ErrorExamples.EMAIL_DUPLICATED)))
    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public TokenResponse signup(@Valid @RequestBody SignupRequest request) {
        var types = EnumSet.noneOf(AuthDtos.TermsType.class);
        request.agreements().forEach(a -> types.add(a.termsType()));
        if (types.size() != AuthDtos.TermsType.values().length) {
            throw new ApiException(ErrorCode.AGREEMENT_REQUIRED);
        }
        return tokens(
                new UserSummary(
                        EXAMPLE_USER_ID, request.email(), request.nickname().strip(), null));
    }

    @Operation(summary = "1.3 로그인")
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
                                            name = "LOGIN_FAILED",
                                            value = ErrorExamples.LOGIN_FAILED)))
    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest request) {
        return tokens(new UserSummary(EXAMPLE_USER_ID, request.email(), EXAMPLE_NICKNAME, null));
    }

    @Operation(summary = "1.4 토큰 재발급", description = "리프레시 토큰으로 새 토큰을 받는다. 보낸 리프레시 토큰은 다시 쓸 수 없다.")
    @SecurityRequirements
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = REFRESH_EXAMPLE)))
    @ApiResponse(
            responseCode = "401",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "REFRESH_TOKEN_INVALID",
                                            value = ErrorExamples.REFRESH_TOKEN_INVALID)))
    @PostMapping("/token/refresh")
    public RefreshResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return new RefreshResponse(
                jwtIssuer.issueAccessToken(EXAMPLE_USER_ID, EXAMPLE_NICKNAME),
                newRefreshToken(),
                jwtIssuer.accessTokenTtlSeconds());
    }

    @Operation(summary = "1.5 로그아웃")
    @ApiResponse(responseCode = "204")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@Valid @RequestBody LogoutRequest request) {}

    private TokenResponse tokens(UserSummary user) {
        return new TokenResponse(
                jwtIssuer.issueAccessToken(user.id(), user.nickname()),
                newRefreshToken(),
                jwtIssuer.accessTokenTtlSeconds(),
                user);
    }

    // 리프레시 토큰은 JWT가 아닌 불투명 값이다(BE 설계 9장)
    private static String newRefreshToken() {
        return UUID.randomUUID().toString();
    }
}
