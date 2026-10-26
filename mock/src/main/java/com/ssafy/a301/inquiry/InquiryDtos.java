package com.ssafy.a301.inquiry;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

public final class InquiryDtos {

    private InquiryDtos() {}

    @Schema(description = "문의 상태. WAITING 답변 대기 · ANSWERED 답변함 · CLOSED 종료")
    public enum InquiryStatus {
        WAITING,
        ANSWERED,
        CLOSED
    }

    @Schema(description = "메시지를 쓴 사람. USER 문의한 사람 · ADMIN 관리자")
    public enum AuthorType {
        USER,
        ADMIN
    }

    // 9.1 ~ 9.5 회원 · 비회원

    @Schema(
            description =
                    "로그인했으면 회원 문의(email · accessPassword는 보내지 않는다), 로그인하지 않았으면 비회원 문의(둘 다 필수)")
    public record InquiryCreateRequest(
            @Schema(description = "문의 제목", example = "비밀번호를 잊어버렸어요", maxLength = 100)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 100, message = "최대 100자입니다.")
                    String title,
            @Schema(description = "첫 질문 본문", example = "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.")
                    @NotBlank(message = "필수 값입니다.")
                    String content,
            @Schema(
                            description = "비회원만: 답변 확인 · 본인 확인에 쓰는 이메일",
                            example = "a@ssafy.com",
                            maxLength = 255,
                            nullable = true)
                    @Email(message = "이메일 형식이 아닙니다.")
                    @Size(max = 255, message = "최대 255자입니다.")
                    String email,
            @Schema(
                            description = "비회원만: 문의를 다시 볼 때 쓰는 조회 비밀번호(4~20자)",
                            example = "1234",
                            minLength = 4,
                            maxLength = 20,
                            nullable = true)
                    @Size(min = 4, max = 20, message = "4~20자입니다.")
                    String accessPassword) {}

    public record InquiryMessageRequest(
            @Schema(description = "질문 또는 답변 본문", example = "확인 부탁드려요.")
                    @NotBlank(message = "필수 값입니다.")
                    String content) {}

    @Schema(description = "문의 메시지 하나(질문 또는 답변)")
    public record InquiryMessage(
            @Schema(description = "메시지 id", example = "21") long id,
            @Schema(description = "쓴 사람") AuthorType authorType,
            @Schema(description = "본문") String content,
            @Schema(description = "쓴 일시") OffsetDateTime createdAt) {}

    @Schema(description = "문의. 문의 id가 곧 문의번호다")
    public record InquiryResponse(
            @Schema(description = "문의 id(문의번호)", example = "7") long id,
            @Schema(description = "문의 제목", example = "비밀번호를 잊어버렸어요") String title,
            @Schema(description = "상태") InquiryStatus status,
            @Schema(description = "문의한 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막으로 질문 · 답변이 달리거나 종료한 일시") OffsetDateTime updatedAt,
            @Schema(description = "주고받은 메시지. 오래된 순") List<InquiryMessage> messages) {}

    public record InquiryListItem(
            @Schema(description = "문의 id(문의번호)", example = "7") long id,
            @Schema(description = "문의 제목", example = "비밀번호를 잊어버렸어요") String title,
            @Schema(description = "상태") InquiryStatus status,
            @Schema(description = "문의한 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막으로 질문 · 답변이 달리거나 종료한 일시") OffsetDateTime updatedAt) {}

    // 9.6 ~ 9.10 관리자

    @Schema(description = "관리자가 보는 문의 메시지. 관리자가 쓴 답변이면 그 관리자 이름이 있다")
    public record AdminInquiryMessage(
            @Schema(description = "메시지 id", example = "22") long id,
            @Schema(description = "쓴 사람") AuthorType authorType,
            @Schema(
                            description = "답변한 관리자 이름. 문의한 사람이 쓴 메시지면 값 없음",
                            example = "운영자",
                            nullable = true)
                    String adminName,
            @Schema(description = "본문") String content,
            @Schema(description = "쓴 일시") OffsetDateTime createdAt) {}

    public record AdminInquiryListItem(
            @Schema(description = "문의 id(문의번호)", example = "7") long id,
            @Schema(description = "문의 제목", example = "비밀번호를 잊어버렸어요") String title,
            @Schema(description = "상태") InquiryStatus status,
            @Schema(description = "문의한 회원 id. 비회원 문의면 값 없음", example = "12", nullable = true)
                    Long userId,
            @Schema(description = "문의한 사람의 이메일(회원이면 회원 이메일)", example = "a@ssafy.com") String email,
            @Schema(description = "문의한 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막으로 질문 · 답변이 달리거나 종료한 일시") OffsetDateTime updatedAt) {}

    public record AdminInquiryResponse(
            @Schema(description = "문의 id(문의번호)", example = "7") long id,
            @Schema(description = "문의 제목", example = "비밀번호를 잊어버렸어요") String title,
            @Schema(description = "상태") InquiryStatus status,
            @Schema(description = "문의한 회원 id. 비회원 문의면 값 없음", example = "12", nullable = true)
                    Long userId,
            @Schema(description = "문의한 회원 닉네임. 비회원 문의면 값 없음", example = "면접왕", nullable = true)
                    String nickname,
            @Schema(description = "문의한 사람의 이메일(회원이면 회원 이메일)", example = "a@ssafy.com") String email,
            @Schema(description = "문의한 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막으로 질문 · 답변이 달리거나 종료한 일시") OffsetDateTime updatedAt,
            @Schema(description = "주고받은 메시지. 오래된 순") List<AdminInquiryMessage> messages) {}

    public record AdminPasswordChangeRequest(
            @Schema(
                            description = "새 비밀번호. 8~64자, 영문·숫자 각 1자 이상(2.3과 같은 규칙)",
                            example = "efgh5678",
                            minLength = 8,
                            maxLength = 64)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(min = 8, max = 64, message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                    @Pattern(
                            regexp = "^(?=.*[A-Za-z])(?=.*\\d).+$",
                            message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                    String newPassword,
            @Schema(
                            description = "요청이 들어온 문의 id. 문의 없이 바꾸면 보내지 않는다",
                            example = "7",
                            nullable = true)
                    Long inquiryId) {}
}
