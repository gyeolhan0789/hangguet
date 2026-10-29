package com.ssafy.a301.user;

import com.ssafy.a301.auth.JwtIssuer;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.user.UserDtos.MeResponse;
import com.ssafy.a301.user.UserDtos.NicknameChangeResponse;
import com.ssafy.a301.user.UserDtos.NicknameRequest;
import com.ssafy.a301.user.UserDtos.PasswordChangeRequest;
import com.ssafy.a301.user.UserDtos.PasswordChangeResponse;
import com.ssafy.a301.user.UserDtos.ProfileImageRequest;
import com.ssafy.a301.user.UserDtos.ProfileImageUploadUrlRequest;
import com.ssafy.a301.user.UserDtos.UploadUrlResponse;
import com.ssafy.a301.user.UserDtos.WithdrawRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "2. 회원")
@RestController
@RequestMapping("/api/v1/users/me")
public class UserController {

    private static final String ME_EXAMPLE =
            """
            { "id": 1, "email": "example@ssafy.com", "nickname": "면접왕", "socialProvider": null,
              "profileImageUrl": "https://…", "createdAt": "2026-09-01T10:00:00+09:00", "currentStreak": 7 }\
            """;
    private static final String NICKNAME_CHANGE_EXAMPLE =
            """
            { "id": 1, "email": "example@ssafy.com", "nickname": "면접왕", "socialProvider": null,
              "profileImageUrl": "https://…", "createdAt": "2026-09-01T10:00:00+09:00", "currentStreak": 7,
              "accessToken": "eyJ…", "expiresIn": 3600 }\
            """;
    private static final String PASSWORD_CHANGE_EXAMPLE =
            """
            { "accessToken": "eyJ…", "refreshToken": "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10", "expiresIn": 3600 }\
            """;
    private static final String UPLOAD_URL_EXAMPLE =
            """
            { "uploadUrl": "https://…s3…?X-Amz-Signature=…", "objectKey": "profile/1/7f3c….png",
              "expiresAt": "2026-10-15T12:10:00+09:00" }\
            """;

    private final Stub stub;
    private final JwtIssuer jwtIssuer;

    public UserController(Stub stub, JwtIssuer jwtIssuer) {
        this.stub = stub;
        this.jwtIssuer = jwtIssuer;
    }

    @Operation(summary = "2.1 내 정보")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = ME_EXAMPLE)))
    @GetMapping
    public MeResponse me() {
        return stub.read(ME_EXAMPLE, MeResponse.class);
    }

    @Operation(
            summary = "2.2 닉네임 변경",
            description = "토큰의 nickname이 바뀌도록 새 액세스 토큰을 함께 준다. 리프레시 토큰은 그대로 쓴다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = NICKNAME_CHANGE_EXAMPLE)))
    @PatchMapping
    public NicknameChangeResponse changeNickname(@Valid @RequestBody NicknameRequest request) {
        MeResponse me = stub.read(ME_EXAMPLE, MeResponse.class);
        String nickname = request.nickname().strip();
        return new NicknameChangeResponse(
                me.id(),
                me.email(),
                nickname,
                me.socialProvider(),
                me.profileImageUrl(),
                me.createdAt(),
                me.currentStreak(),
                jwtIssuer.issueAccessToken(me.id(), nickname),
                jwtIssuer.accessTokenTtlSeconds());
    }

    @Operation(
            summary = "2.3 비밀번호 변경",
            description =
                    "이 기기는 새 토큰으로 로그인을 유지하고, 다른 기기는 모두 로그아웃한다. 바꾸기 전에 받은 리프레시 토큰은 이 기기 것도"
                            + " 쓸 수 없으므로 응답의 토큰으로 바꿔 저장한다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = PASSWORD_CHANGE_EXAMPLE)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PASSWORD_MISMATCH",
                                            value = ErrorExamples.PASSWORD_MISMATCH)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PASSWORD_NOT_SET",
                                            value = ErrorExamples.PASSWORD_NOT_SET)))
    @PatchMapping("/password")
    public PasswordChangeResponse changePassword(
            @Valid @RequestBody PasswordChangeRequest request) {
        MeResponse me = stub.read(ME_EXAMPLE, MeResponse.class);
        return new PasswordChangeResponse(
                jwtIssuer.issueAccessToken(me.id(), me.nickname()),
                UUID.randomUUID().toString(),
                jwtIssuer.accessTokenTtlSeconds());
    }

    @Operation(summary = "2.4 프로필 사진 업로드 주소")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = UPLOAD_URL_EXAMPLE)))
    @PostMapping("/profile-image/upload-url")
    public UploadUrlResponse profileImageUploadUrl(
            @Valid @RequestBody ProfileImageUploadUrlRequest request) {
        return stub.read(UPLOAD_URL_EXAMPLE, UploadUrlResponse.class);
    }

    @Operation(summary = "2.5 프로필 사진 등록")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = ME_EXAMPLE)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "VALIDATION_FAILED",
                                            value = ErrorExamples.PROFILE_IMAGE_KEY_INVALID)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "FILE_NOT_FOUND",
                                            value = ErrorExamples.FILE_NOT_FOUND)))
    @PutMapping("/profile-image")
    public MeResponse registerProfileImage(@Valid @RequestBody ProfileImageRequest request) {
        return stub.read(ME_EXAMPLE, MeResponse.class);
    }

    @Operation(summary = "2.6 프로필 사진 삭제")
    @ApiResponse(responseCode = "204")
    @DeleteMapping("/profile-image")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteProfileImage() {}

    @Operation(
            summary = "2.7 회원 탈퇴",
            description = "회원을 탈퇴 처리하고 모든 토큰을 무효로 만든다. 소셜 회원은 비밀번호 없이 탈퇴한다.")
    @ApiResponse(responseCode = "204")
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PASSWORD_MISMATCH",
                                            value = ErrorExamples.PASSWORD_MISMATCH)))
    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(@Valid @RequestBody WithdrawRequest request) {}
}
