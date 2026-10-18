package com.ssafy.a301.user;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.user.UserDtos.MeResponse;
import com.ssafy.a301.user.UserDtos.NicknameRequest;
import com.ssafy.a301.user.UserDtos.PasswordChangeRequest;
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
            { "id": 1, "email": "example@ssafy.com", "nickname": "면접왕", "profileImageUrl": "https://…",
              "createdAt": "2026-09-01T10:00:00+09:00", "currentStreak": 7 }\
            """;
    private static final String UPLOAD_URL_EXAMPLE =
            """
            { "uploadUrl": "https://…s3…?X-Amz-Signature=…", "objectKey": "profile/1/7f3c….png",
              "expiresAt": "2026-10-15T12:10:00+09:00" }\
            """;

    private final Stub stub;

    public UserController(Stub stub) {
        this.stub = stub;
    }

    @Operation(summary = "2.1 내 정보")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = ME_EXAMPLE)))
    @GetMapping
    public MeResponse me() {
        return stub.read(ME_EXAMPLE, MeResponse.class);
    }

    @Operation(summary = "2.2 닉네임 변경")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = ME_EXAMPLE)))
    @PatchMapping
    public MeResponse changeNickname(@Valid @RequestBody NicknameRequest request) {
        return stub.read(ME_EXAMPLE, MeResponse.class);
    }

    @Operation(summary = "2.3 비밀번호 변경")
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
    @PatchMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@Valid @RequestBody PasswordChangeRequest request) {}

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

    @Operation(summary = "2.7 회원 탈퇴", description = "탈퇴 처리하고 모든 토큰을 폐기한다.")
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
