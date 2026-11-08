package com.ssafy.a301.auth;

import com.ssafy.a301.auth.AuthDtos.EmailAvailabilityResponse;
import com.ssafy.a301.auth.AuthDtos.LoginRequest;
import com.ssafy.a301.auth.AuthDtos.LogoutRequest;
import com.ssafy.a301.auth.AuthDtos.PasswordResetConfirmRequest;
import com.ssafy.a301.auth.AuthDtos.PasswordResetRequest;
import com.ssafy.a301.auth.AuthDtos.RefreshRequest;
import com.ssafy.a301.auth.AuthDtos.RefreshResponse;
import com.ssafy.a301.auth.AuthDtos.SignupRequest;
import com.ssafy.a301.auth.AuthDtos.SocialLoginRequest;
import com.ssafy.a301.auth.AuthDtos.SocialLoginResponse;
import com.ssafy.a301.auth.AuthDtos.SocialSignup;
import com.ssafy.a301.auth.AuthDtos.SocialSignupRequest;
import com.ssafy.a301.auth.AuthDtos.TokenResponse;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
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
import java.time.Duration;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
    private static final String SOCIAL_LOGGED_IN_EXAMPLE =
            """
            { "signupRequired": false, "signup": null,
              "token": { "accessToken": "eyJ…", "refreshToken": "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10",
                         "expiresIn": 3600,
                         "user": { "id": 1, "email": "a@kakao.com", "nickname": "면접왕", "profileImageUrl": null } } }\
            """;
    private static final String SOCIAL_SIGNUP_EXAMPLE =
            """
            { "signupRequired": true, "token": null,
              "signup": { "signupToken": "Zm9v…", "email": "a@kakao.com", "nickname": "면접왕", "expiresIn": 600 } }\
            """;
    private static final String REFRESH_EXAMPLE =
            """
            { "accessToken": "eyJ…", "refreshToken": "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10", "expiresIn": 3600 }\
            """;

    // 목 서버는 회원을 저장하지 않아 로그인·재발급은 이 예시 회원으로 토큰을 만든다
    private static final long EXAMPLE_USER_ID = 1L;
    private static final String EXAMPLE_NICKNAME = "면접왕";
    private static final String SOCIAL_EMAIL = "a@kakao.com";
    private static final long SIGNUP_TOKEN_TTL_SECONDS = 600;
    private static final Duration LOGIN_LOCK = Duration.ofMinutes(15);

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
        requireAllTerms(request.agreements());
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
    @ApiResponse(
            responseCode = "429",
            description =
                    "같은 이메일로 5번 연속 틀려 15분 동안 잠김. 남은 시간은 Retry-After 헤더 · retryAfterSeconds(초)",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "LOGIN_LOCKED",
                                            value = ErrorExamples.LOGIN_LOCKED)))
    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest request) {
        // 목 서버: locked@로 시작하는 이메일은 잠긴 것으로 답한다
        if (request.email().startsWith("locked@")) {
            throw new ApiException(ErrorCode.LOGIN_LOCKED, LOGIN_LOCK);
        }
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

    @Operation(
            summary = "1.6 소셜 로그인",
            description =
                    "제공자 인가 코드로 로그인한다. 연결된 회원이면 token, 처음 온 사람이면 signup(1.7로 가입)을 준다. 목 서버는 code로"
                            + " 결과를 고른다: `signup` 가입 필요 · `no-email` 400 SOCIAL_EMAIL_REQUIRED ·"
                            + " `duplicated` 409 · `invalid` 401 · 그 밖은 가입한 회원으로 로그인(뼈대 서버)")
    @SecurityRequirements
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "가입한 회원", value = SOCIAL_LOGGED_IN_EXAMPLE),
                                @ExampleObject(name = "처음 온 사람", value = SOCIAL_SIGNUP_EXAMPLE)
                            }))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "SOCIAL_EMAIL_REQUIRED",
                                        value = ErrorExamples.SOCIAL_EMAIL_REQUIRED),
                                @ExampleObject(
                                        name = "VALIDATION_FAILED",
                                        value = ErrorExamples.VALIDATION_FAILED)
                            }))
    @ApiResponse(
            responseCode = "401",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SOCIAL_LOGIN_FAILED",
                                            value = ErrorExamples.SOCIAL_LOGIN_FAILED)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SOCIAL_EMAIL_DUPLICATED",
                                            value = ErrorExamples.SOCIAL_EMAIL_DUPLICATED)))
    @ApiResponse(
            responseCode = "503",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SOCIAL_LOGIN_UNAVAILABLE",
                                            value = ErrorExamples.SOCIAL_LOGIN_UNAVAILABLE)))
    @PostMapping("/oauth/{provider}")
    public SocialLoginResponse socialLogin(
            @Parameter(description = "제공자. `kakao` · `google`", example = "kakao") @PathVariable
                    String provider,
            @Valid @RequestBody SocialLoginRequest request) {
        if (!"kakao".equalsIgnoreCase(provider) && !"google".equalsIgnoreCase(provider)) {
            throw new FieldValidationException("provider", "지원하지 않는 로그인 방법입니다.");
        }
        return switch (request.code()) {
            case "signup" ->
                    new SocialLoginResponse(
                            true,
                            null,
                            new SocialSignup(
                                    UUID.randomUUID().toString(),
                                    SOCIAL_EMAIL,
                                    EXAMPLE_NICKNAME,
                                    SIGNUP_TOKEN_TTL_SECONDS));
            case "no-email" -> throw new ApiException(ErrorCode.SOCIAL_EMAIL_REQUIRED);
            case "duplicated" -> throw new ApiException(ErrorCode.SOCIAL_EMAIL_DUPLICATED);
            case "invalid" -> throw new ApiException(ErrorCode.SOCIAL_LOGIN_FAILED);
            default ->
                    new SocialLoginResponse(
                            false,
                            tokens(
                                    new UserSummary(
                                            EXAMPLE_USER_ID, SOCIAL_EMAIL, EXAMPLE_NICKNAME, null)),
                            null);
        };
    }

    @Operation(
            summary = "1.7 소셜 회원가입",
            description =
                    "1.6에서 받은 가입 토큰과 필수 약관 3개 동의로 비밀번호 없는 회원을 만들고 로그인 토큰을 준다."
                            + " 목 서버는 signupToken이 `expired`면 401 SIGNUP_TOKEN_INVALID(뼈대 서버)")
    @SecurityRequirements
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = TOKEN_EXAMPLE)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "AGREEMENT_REQUIRED",
                                            value = ErrorExamples.AGREEMENT_REQUIRED)))
    @ApiResponse(
            responseCode = "401",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SIGNUP_TOKEN_INVALID",
                                            value = ErrorExamples.SIGNUP_TOKEN_INVALID)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SOCIAL_EMAIL_DUPLICATED",
                                            value = ErrorExamples.SOCIAL_EMAIL_DUPLICATED)))
    @PostMapping("/oauth/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public TokenResponse socialSignup(@Valid @RequestBody SocialSignupRequest request) {
        requireAllTerms(request.agreements());
        if ("expired".equals(request.signupToken())) {
            throw new ApiException(ErrorCode.SIGNUP_TOKEN_INVALID);
        }
        return tokens(new UserSummary(EXAMPLE_USER_ID, SOCIAL_EMAIL, EXAMPLE_NICKNAME, null));
    }

    @Operation(
            summary = "1.8 비밀번호 찾기 메일 요청",
            description =
                    "이메일 회원에게 30분 동안 한 번 쓸 수 있는 재설정 링크를 메일로 보낸다. 없는 이메일 · 소셜 회원도 같은 204(메일 없음)."
                            + " 같은 이메일은 1분 안에 다시 보내지 않는다. 목 서버는 메일을 보내지 않고 항상 204")
    @SecurityRequirements
    @ApiResponse(responseCode = "204", description = "요청 받음(메일 발송 여부와 관계없이)")
    @PostMapping("/password-reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void requestPasswordReset(@Valid @RequestBody PasswordResetRequest request) {}

    @Operation(
            summary = "1.9 비밀번호 재설정",
            description =
                    "메일 링크의 token으로 새 비밀번호를 정한다. 모든 기기가 로그아웃되므로 새 비밀번호로 다시 로그인(1.3)한다."
                            + " 목 서버는 token이 `expired`면 400 PASSWORD_RESET_TOKEN_INVALID")
    @SecurityRequirements
    @ApiResponse(responseCode = "204", description = "변경")
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PASSWORD_RESET_TOKEN_INVALID",
                                            value = ErrorExamples.PASSWORD_RESET_TOKEN_INVALID)))
    @PostMapping("/password-reset/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void confirmPasswordReset(@Valid @RequestBody PasswordResetConfirmRequest request) {
        if ("expired".equals(request.token())) {
            throw new ApiException(ErrorCode.PASSWORD_RESET_TOKEN_INVALID);
        }
    }

    private static void requireAllTerms(List<AuthDtos.AgreementRequest> agreements) {
        var types = EnumSet.noneOf(AuthDtos.TermsType.class);
        agreements.forEach(a -> types.add(a.termsType()));
        if (types.size() != AuthDtos.TermsType.values().length) {
            throw new ApiException(ErrorCode.AGREEMENT_REQUIRED);
        }
    }

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
