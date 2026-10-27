package com.ssafy.a301.user.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

public final class UserDtos {

    private UserDtos() {}

    @Schema(description = "토큰 응답에 담기는 회원")
    public record UserSummary(
            @Schema(description = "회원 id", example = "1") long id,
            @Schema(description = "로그인 아이디", example = "a@ssafy.com") String email,
            @Schema(description = "닉네임", example = "면접왕") String nickname,
            @Schema(description = "프로필 사진 임시 주소(만료됨). 등록하지 않았으면 null", nullable = true)
                    String profileImageUrl) {}

    public record MeResponse(
            @Schema(description = "회원 id", example = "1") long id,
            @Schema(description = "로그인 아이디", example = "example@ssafy.com") String email,
            @Schema(description = "닉네임", example = "면접왕") String nickname,
            @Schema(description = "프로필 사진 임시 주소(만료됨). 등록하지 않았으면 null", nullable = true)
                    String profileImageUrl,
            @Schema(description = "가입 일시. S09 \"2026년 9월 시작\"") OffsetDateTime createdAt,
            @Schema(
                            description =
                                    "현재 스트릭(오늘 또는 어제까지 빠짐없이 이어진 연습일 수). 모든 화면 헤더(C01) \"스트릭 7일\"",
                            example = "7")
                    int currentStreak) {}

    @Schema(description = "2.1 내 정보에 새 닉네임을 담은 액세스 토큰을 더한 응답")
    public record NicknameChangeResponse(
            @Schema(description = "회원 id", example = "1") long id,
            @Schema(description = "로그인 아이디", example = "example@ssafy.com") String email,
            @Schema(description = "닉네임", example = "면접왕") String nickname,
            @Schema(description = "프로필 사진 임시 주소(만료됨). 등록하지 않았으면 null", nullable = true)
                    String profileImageUrl,
            @Schema(description = "가입 일시. S09 \"2026년 9월 시작\"") OffsetDateTime createdAt,
            @Schema(description = "현재 스트릭", example = "7") int currentStreak,
            @Schema(description = "새 닉네임을 담은 액세스 토큰. 리프레시 토큰은 그대로 쓴다", example = "eyJ…")
                    String accessToken,
            @Schema(description = "액세스 토큰 유효 시간(초)", example = "3600") long expiresIn) {}

    public record NicknameRequest(
            @Schema(description = "새 닉네임. 앞뒤 공백 제거", example = "면접왕", minLength = 1, maxLength = 50)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 50, message = "1~50자입니다.")
                    String nickname) {}

    public record PasswordChangeResponse(
            @Schema(description = "새 액세스 토큰. 1.3 응답의 accessToken과 같은 형식", example = "eyJ…")
                    String accessToken,
            @Schema(
                            description = "새 리프레시 토큰. 이 기기를 포함해 바꾸기 전에 받은 리프레시 토큰은 모두 쓸 수 없다",
                            example = "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10")
                    String refreshToken,
            @Schema(description = "액세스 토큰 유효 시간(초)", example = "3600") long expiresIn) {}

    public record PasswordChangeRequest(
            @Schema(description = "지금 비밀번호", example = "abcd1234", maxLength = 64)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 64, message = "최대 64자입니다.")
                    String currentPassword,
            @Schema(
                            description = "새 비밀번호. 8~64자, 영문·숫자 각 1자 이상",
                            example = "efgh5678",
                            minLength = 8,
                            maxLength = 64)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(min = 8, max = 64, message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                    @Pattern(
                            regexp = "^(?=.*[A-Za-z])(?=.*\\d).+$",
                            message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                    String newPassword) {}

    public record ProfileImageUploadUrlRequest(
            @Schema(
                            description = "올릴 파일 형식",
                            allowableValues = {"image/jpeg", "image/png"},
                            example = "image/png")
                    @NotBlank(message = "필수 값입니다.")
                    @Pattern(regexp = "image/jpeg|image/png", message = "JPG·PNG만 올릴 수 있습니다.")
                    String contentType,
            @Schema(description = "파일 크기(바이트). 1~5,242,880(5MB)", example = "204800")
                    @NotNull(message = "필수 값입니다.")
                    @Min(value = 1, message = "1바이트 이상입니다.")
                    @Max(value = 5_242_880, message = "5MB 이하만 올릴 수 있습니다.")
                    Long size) {}

    @Schema(description = "업로드 주소(2.4). 받은 주소로 파일을 PUT한 뒤 등록 API에 objectKey를 보낸다")
    public record UploadUrlResponse(
            @Schema(description = "파일을 PUT할 임시 주소") String uploadUrl,
            @Schema(description = "올린 파일의 키. 등록 API에 그대로 보낸다") String objectKey,
            @Schema(description = "uploadUrl 만료 일시") OffsetDateTime expiresAt) {}

    public record ProfileImageRequest(
            @Schema(description = "2.4에서 받은 objectKey", example = "profile/1/7f3c….png")
                    @NotBlank(message = "필수 값입니다.")
                    String objectKey) {}

    public record WithdrawRequest(
            @Schema(description = "본인 확인용 비밀번호", example = "abcd1234", maxLength = 64)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 64, message = "최대 64자입니다.")
                    String password) {}
}
