package com.ssafy.a301.application;

import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

public final class ApplicationDtos {

    private ApplicationDtos() {}

    @Schema(description = "자기소개서 문항 하나(ERD cover_letter_items)")
    public record CoverLetterItemRequest(
            @Schema(description = "기업이 낸 문항 질문", example = "지원 동기", minLength = 1, maxLength = 255)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 255, message = "1~255자입니다.")
                    String question,
            @Schema(
                            description = "답변",
                            example = "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어…",
                            minLength = 1,
                            maxLength = 20000)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 20000, message = "1~20,000자입니다.")
                    String answer) {}

    public record ApplicationCreateRequest(
            @Schema(description = "지원 회사명", example = "○○전자", minLength = 1, maxLength = 100)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 100, message = "1~100자입니다.")
                    String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자", minLength = 1, maxLength = 100)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 100, message = "1~100자입니다.")
                    String jobTitle,
            @ArraySchema(
                            arraySchema = @Schema(description = "자기소개서 문항. 적은 순서가 문항 순서(1부터)"),
                            minItems = 1,
                            maxItems = 5)
                    @NotNull(message = "필수 값입니다.")
                    @Size(min = 1, max = 5, message = "1~5개입니다.")
                    List<@NotNull(message = "필수 값입니다.") @Valid CoverLetterItemRequest>
                            coverLetterItems) {}

    @Schema(description = "저장된 자기소개서 문항(ERD cover_letter_items)")
    public record CoverLetterItem(
            @Schema(description = "문항 순서(1부터)", example = "1") int itemOrder,
            @Schema(description = "문항 질문", example = "지원 동기") String question,
            @Schema(description = "답변", example = "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어…")
                    String answer) {}

    public record ApplicationResponse(
            @Schema(description = "지원서 id. 면접 만들기(5.1)의 applicationId", example = "12") long id,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            @Schema(description = "자기소개서 문항. 문항 순서대로") List<CoverLetterItem> coverLetterItems,
            @Schema(description = "작성 일시") OffsetDateTime createdAt) {}

    public record ApplicationListItem(
            @Schema(description = "지원서 id", example = "12") long id,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            @Schema(description = "작성 일시") OffsetDateTime createdAt) {}
}
