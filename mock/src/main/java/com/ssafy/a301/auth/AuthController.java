package com.ssafy.a301.auth;

import com.ssafy.a301.auth.AuthDtos.EmailAvailabilityResponse;
import com.ssafy.a301.auth.AuthDtos.LoginRequest;
import com.ssafy.a301.auth.AuthDtos.LogoutRequest;
import com.ssafy.a301.auth.AuthDtos.RefreshRequest;
import com.ssafy.a301.auth.AuthDtos.RefreshResponse;
import com.ssafy.a301.auth.AuthDtos.SignupRequest;
import com.ssafy.a301.auth.AuthDtos.TokenResponse;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
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

    private static final String TOKEN_EXAMPLE =
            """
            { "accessToken": "eyJ…", "refreshToken": "eyJ…", "expiresIn": 3600,
              "user": { "id": 1, "email": "a@ssafy.com", "nickname": "면접왕", "profileImageUrl": null } }\
            """;
    private static final String REFRESH_EXAMPLE =
            """
            { "accessToken": "eyJ…", "refreshToken": "eyJ…", "expiresIn": 3600 }\
            """;

    private final Stub stub;

    public AuthController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "1.1 이메일 사용 가능 여부",
            description =
                    "탈퇴하지 않은 회원 중 같은 이메일이 없으면 사용 가능하다. 사용 중이어도 오류가 아니라 `available: false`로 답한다.")
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

    @Operation(summary = "1.2 회원가입", description = "회원을 만들고 필수 약관 3개 동의를 기록한 뒤 로그인 토큰을 준다.")
    @SecurityRequirements
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
        return stub.read(TOKEN_EXAMPLE, TokenResponse.class);
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
        return stub.read(TOKEN_EXAMPLE, TokenResponse.class);
    }

    @Operation(summary = "1.4 토큰 재발급", description = "새 액세스·리프레시 토큰을 준다. 쓴 리프레시 토큰은 폐기된다.")
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
        return stub.read(REFRESH_EXAMPLE, RefreshResponse.class);
    }

    @Operation(summary = "1.5 로그아웃")
    @ApiResponse(responseCode = "204")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@Valid @RequestBody LogoutRequest request) {}
}
