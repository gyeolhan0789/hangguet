package com.ssafy.a301.application;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

public final class ApplicationDtos {

    private ApplicationDtos() {}

    public record ApplicationCreateRequest(
            @Schema(description = "지원 회사명", example = "○○전자", minLength = 1, maxLength = 100)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 100, message = "1~100자입니다.")
                    String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자", minLength = 1, maxLength = 100)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 100, message = "1~100자입니다.")
                    String jobTitle,
            @Schema(
                            description = "자기소개서(문항과 답변)",
                            example = "1. 지원 동기\n저는…",
                            minLength = 1,
                            maxLength = 3000)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 3000, message = "1~3,000자입니다.")
                    String coverLetter) {}

    @Schema(description = "보낸 필드만 바꾼다")
    public record ApplicationUpdateRequest(
            @Schema(
                            description = "지원 회사명",
                            example = "○○전자",
                            minLength = 1,
                            maxLength = 100,
                            nullable = true)
                    @Size(min = 1, max = 100, message = "1~100자입니다.")
                    @Pattern(regexp = ".*\\S.*", message = "공백만으로는 바꿀 수 없습니다.")
                    String companyName,
            @Schema(
                            description = "지원 직무",
                            example = "백엔드 개발자",
                            minLength = 1,
                            maxLength = 100,
                            nullable = true)
                    @Size(min = 1, max = 100, message = "1~100자입니다.")
                    @Pattern(regexp = ".*\\S.*", message = "공백만으로는 바꿀 수 없습니다.")
                    String jobTitle,
            @Schema(
                            description = "자기소개서",
                            example = "1. 지원 동기(수정)\n저는…",
                            minLength = 1,
                            maxLength = 3000,
                            nullable = true)
                    @Size(min = 1, max = 3000, message = "1~3,000자입니다.")
                    @Pattern(regexp = ".*\\S.*", message = "공백만으로는 바꿀 수 없습니다.")
                    String coverLetter) {}

    public record ApplicationResponse(
            @Schema(description = "지원서 id. 면접 만들기(5.1)의 applicationId", example = "10") long id,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            @Schema(description = "자기소개서") String coverLetter,
            @Schema(description = "작성 일시") OffsetDateTime createdAt,
            @Schema(description = "면접에 쓴 적이 있으면 true(수정·삭제 불가). 새로 만들면 false") boolean inUse) {}

    public record ApplicationListItem(
            @Schema(description = "지원서 id", example = "12") long id,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            @Schema(description = "작성 일시") OffsetDateTime createdAt,
            @Schema(description = "면접에 쓴 적이 있으면 true → 화면은 수정·삭제 버튼을 끈다") boolean inUse) {}
}
