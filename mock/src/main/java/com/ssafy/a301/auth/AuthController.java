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
                    """
                    **화면 — S01-1 회원가입 › 이메일 입력 즉시 검사**

                    탈퇴하지 않은 회원 중 같은 이메일이 없으면 사용 가능하다. 탈퇴한 회원이 쓰던 이메일은 다시 쓸 수 있다.

                    - **200**: 항상. 사용 중이면 `available: false`(오류 아님)\
                    """)
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

    @Operation(
            summary = "1.2 회원가입",
            description =
                    """
                    **화면 — S01-1 회원가입 › [가입하고 시작하기]**

                    회원을 만들고 필수 약관 3개 동의를 기록한 뒤 로그인 토큰을 준다. 화면은 S02-D(첫 방문 홈)로 간다.

                    - **201**: 가입 완료. 로그인 상태
                    - **400 / AGREEMENT_REQUIRED**: 약관 3개 중 하나라도 없음. 가입하지 않음
                    - **400 / VALIDATION_FAILED**: 이메일·비밀번호·닉네임 조건 불일치. 칸마다 `errors`
                    - **409 / EMAIL_DUPLICATED**: 사용 중인 이메일(1.1 이후 다른 사람이 먼저 가입한 경우 포함)\
                    """)
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

    @Operation(
            summary = "1.3 로그인",
            description =
                    """
                    **화면 — S01 로그인 › [로그인]** → S02 홈(하루 첫 진입이면 S02-1)

                    자동 로그인 유지(스트릭 유지 목적)를 위해 리프레시 토큰 유효 기간을 길게 둔다(값은 BE 결정). 비밀번호 찾기는 MVP 제외.

                    - **200**: 이메일·비밀번호 일치
                    - **401 / LOGIN_FAILED**: 이메일 없음·비밀번호 틀림·탈퇴 회원. 구분 없이 같은 문구\
                    """)
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

    @Operation(
            summary = "1.4 토큰 재발급",
            description =
                    """
                    **화면 — 공통. 액세스 토큰 만료 시**

                    새 액세스·리프레시 토큰을 준다. 쓴 리프레시 토큰은 폐기된다.

                    - **200**: 유효한 리프레시 토큰
                    - **401 / REFRESH_TOKEN_INVALID**: 만료·재사용·로그아웃·탈퇴로 폐기됨. 화면은 S01로\
                    """)
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

    @Operation(
            summary = "1.5 로그아웃",
            description =
                    """
                    **화면 — C01 프로필 메뉴, S09-1 설정** → 확인 없이 S00

                    - **204**: 로그아웃. 이미 폐기된 토큰이어도 204\
                    """)
    @ApiResponse(responseCode = "204")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@Valid @RequestBody LogoutRequest request) {}
}
