package com.ssafy.a301.user;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.UserDtos.MeResponse;
import com.ssafy.a301.user.UserDtos.SocialLinkRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "2. 회원")
@RestController
@RequestMapping("/api/v1/users/me/social-accounts/{provider}")
public class SocialAccountController {

    private static final String LINKED_EXAMPLE =
            """
            { "id": 1, "email": "example@ssafy.com", "nickname": "면접왕", "socialProvider": null,
              "linkedProvider": "KAKAO", "profileImageUrl": "https://…",
              "createdAt": "2026-09-01T10:00:00+09:00", "currentStreak": 7 }\
            """;

    private final Stub stub;

    public SocialAccountController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "2.12 소셜 계정 연결",
            description =
                    "이메일 회원이 카카오 로그인으로 받은 인가 코드를 보내 카카오 계정을 연결한다. 응답은 2.1과 같다. 목 서버는 code로 결과를"
                            + " 고른다: `invalid` 400 SOCIAL_LINK_FAILED · `already` 409"
                            + " SOCIAL_ALREADY_LINKED · `in-use` 409 SOCIAL_ACCOUNT_IN_USE ·"
                            + " `unavailable` 503 · 그 밖은 연결됨")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = LINKED_EXAMPLE)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SOCIAL_LINK_FAILED",
                                            value = ErrorExamples.SOCIAL_LINK_FAILED)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "SOCIAL_ALREADY_LINKED",
                                        value = ErrorExamples.SOCIAL_ALREADY_LINKED),
                                @ExampleObject(
                                        name = "SOCIAL_ACCOUNT_IN_USE",
                                        value = ErrorExamples.SOCIAL_ACCOUNT_IN_USE)
                            }))
    @ApiResponse(
            responseCode = "503",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SOCIAL_LOGIN_UNAVAILABLE",
                                            value = ErrorExamples.SOCIAL_LOGIN_UNAVAILABLE)))
    @PutMapping
    public MeResponse link(
            @Parameter(description = "kakao만 지원", example = "kakao") @PathVariable String provider,
            @Valid @RequestBody SocialLinkRequest request) {
        requireKakao(provider);
        switch (request.code()) {
            case "invalid" -> throw new ApiException(ErrorCode.SOCIAL_LINK_FAILED);
            case "already" -> throw new ApiException(ErrorCode.SOCIAL_ALREADY_LINKED);
            case "in-use" -> throw new ApiException(ErrorCode.SOCIAL_ACCOUNT_IN_USE);
            case "unavailable" -> throw new ApiException(ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
            default -> {
                return stub.read(LINKED_EXAMPLE, MeResponse.class);
            }
        }
    }

    @Operation(
            summary = "2.13 소셜 계정 연결 해제",
            description =
                    "카카오 로그인 연결을 끊고 켜져 있던 연습 알림을 끈다. 연결하지 않았어도 204. 소셜 회원은 409 PASSWORD_NOT_SET")
    @ApiResponse(responseCode = "204")
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PASSWORD_NOT_SET",
                                            value = ErrorExamples.PASSWORD_NOT_SET)))
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unlink(
            @Parameter(description = "kakao만 지원", example = "kakao") @PathVariable
                    String provider) {
        requireKakao(provider);
    }

    private static void requireKakao(String provider) {
        if (!"kakao".equalsIgnoreCase(provider)) {
            throw new FieldValidationException("provider", "지원하지 않는 연결 방법입니다.");
        }
    }
}
