package com.ssafy.a301.user.controller;

import com.ssafy.a301.user.dto.UserDtos.MeResponse;
import com.ssafy.a301.user.dto.UserDtos.NicknameChangeResponse;
import com.ssafy.a301.user.dto.UserDtos.NicknameRequest;
import com.ssafy.a301.user.dto.UserDtos.PasswordChangeRequest;
import com.ssafy.a301.user.dto.UserDtos.PasswordChangeResponse;
import com.ssafy.a301.user.dto.UserDtos.ProfileImageRequest;
import com.ssafy.a301.user.dto.UserDtos.ProfileImageUploadUrlRequest;
import com.ssafy.a301.user.dto.UserDtos.UploadUrlResponse;
import com.ssafy.a301.user.dto.UserDtos.WithdrawRequest;
import com.ssafy.a301.user.service.PasswordChangeService;
import com.ssafy.a301.user.service.UserService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
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
    private final UserService service;
    private final PasswordChangeService passwordChanges;

    public UserController(UserService service, PasswordChangeService passwordChanges) {
        this.service = service;
        this.passwordChanges = passwordChanges;
    }

    @Operation(summary = "2.1 내 정보", description = "현재 스트릭과 프로필 사진 임시 주소를 함께 준다.")
    @GetMapping
    public MeResponse me(@AuthenticationPrincipal Jwt jwt) {
        return service.me(userId(jwt));
    }

    @Operation(
            summary = "2.2 닉네임 변경",
            description = "토큰의 nickname이 바뀌도록 새 액세스 토큰을 함께 준다. 리프레시 토큰은 그대로 쓴다.")
    @PatchMapping
    public NicknameChangeResponse changeNickname(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NicknameRequest request) {
        return service.changeNickname(userId(jwt), request.nickname());
    }

    @Operation(
            summary = "2.3 비밀번호 변경",
            description =
                    "이 기기는 새 토큰으로 로그인을 유지하고, 다른 기기는 모두 로그아웃한다. 바꾸기 전에 받은 리프레시 토큰은 이 기기 것도"
                            + " 쓸 수 없으므로 응답의 토큰으로 바꿔 저장한다.")
    @ApiResponse(responseCode = "200", description = "변경")
    @ApiResponse(responseCode = "400", description = "PASSWORD_MISMATCH: 현재 비밀번호 틀림")
    @PatchMapping("/password")
    public PasswordChangeResponse changePassword(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PasswordChangeRequest request) {
        return passwordChanges.changeByUser(
                userId(jwt), request.currentPassword(), request.newPassword());
    }

    @Operation(
            summary = "2.4 프로필 사진 업로드 주소",
            description = "받은 uploadUrl로 요청한 형식(Content-Type)과 크기의 파일을 PUT한 뒤 2.5에 objectKey를 보낸다.")
    @PostMapping("/profile-image/upload-url")
    public UploadUrlResponse profileImageUploadUrl(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ProfileImageUploadUrlRequest request) {
        return service.profileImageUploadUrl(userId(jwt), request.contentType(), request.size());
    }

    @Operation(summary = "2.5 프로필 사진 등록", description = "이전 사진이 있으면 바꾸고 이전 파일은 지운다.")
    @ApiResponse(responseCode = "200", description = "등록")
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: 본인에게 발급된 키가 아님")
    @ApiResponse(responseCode = "404", description = "FILE_NOT_FOUND: S3에 파일 없음")
    @PutMapping("/profile-image")
    public MeResponse registerProfileImage(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ProfileImageRequest request) {
        return service.registerProfileImage(userId(jwt), request.objectKey());
    }

    @Operation(summary = "2.6 프로필 사진 삭제", description = "이미 없어도 204")
    @ApiResponse(responseCode = "204", description = "삭제")
    @DeleteMapping("/profile-image")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteProfileImage(@AuthenticationPrincipal Jwt jwt) {
        service.deleteProfileImage(userId(jwt));
    }

    @Operation(
            summary = "2.7 회원 탈퇴",
            description = "비밀번호를 확인하고 탈퇴 처리한 뒤 모든 기기의 토큰을 무효로 만든다. 되돌릴 수 없고, 이메일은 재가입에 쓸 수 있다.")
    @ApiResponse(responseCode = "204", description = "탈퇴")
    @ApiResponse(responseCode = "400", description = "PASSWORD_MISMATCH: 비밀번호 틀림")
    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void withdraw(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody WithdrawRequest request) {
        service.withdraw(userId(jwt), request.password());
    }

    private static long userId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
