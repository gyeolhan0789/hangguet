package com.ssafy.a301.group.dto;

import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.JobCategory;
import com.ssafy.a301.group.domain.ParticipantState;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.List;

public final class GroupDtos {

    private GroupDtos() {}

    public record GroupCreateRequest(
            @Schema(description = "면접 방식. 참가자 모두 같다", example = "VIDEO")
                    @NotNull(message = "필수 값입니다.")
                    InterviewMode mode,
            @Schema(description = "면접관. 참가자 모두 같다", example = "COFFEE_CHAT")
                    @NotNull(message = "필수 값입니다.")
                    Persona persona,
            @Schema(description = "정원(방장 포함) 2 · 3", example = "3")
                    @NotNull(message = "필수 값입니다.")
                    @Min(value = 2, message = "2~3명입니다.")
                    @Max(value = 3, message = "2~3명입니다.")
                    Integer capacity,
            @Schema(description = "그룹 직군 대분류", example = "DEVELOPMENT")
                    @NotNull(message = "필수 값입니다.")
                    JobCategory jobCategory,
            @Schema(description = "방장의 면접에 쓸 본인 지원서 id", example = "12")
                    @NotNull(message = "필수 값입니다.")
                    @Positive(message = "지원서 id입니다.")
                    Long applicationId) {}

    public record GroupJoinRequest(
            @Schema(description = "초대 코드 6자리", example = "K7Q2ZP") @NotBlank(message = "필수 값입니다.")
                    String inviteCode,
            @Schema(description = "내 면접에 쓸 본인 지원서 id", example = "15")
                    @NotNull(message = "필수 값입니다.")
                    @Positive(message = "지원서 id입니다.")
                    Long applicationId,
            @Schema(description = "내 직군 대분류. 그룹과 달라도 들어갈 수 있다", example = "DATA_AI")
                    @NotNull(message = "필수 값입니다.")
                    JobCategory jobCategory) {}

    public record ReadyRequest(
            @Schema(description = "true 준비 완료 · false 준비 취소", example = "true")
                    @NotNull(message = "필수 값입니다.")
                    Boolean ready) {}

    public record InviteResponse(
            @Schema(description = "그룹 id", example = "7") long groupId,
            @Schema(description = "방장 닉네임", example = "면접왕") String hostNickname,
            InterviewMode mode,
            Persona persona,
            JobCategory jobCategory,
            @Schema(description = "정원 2 · 3", example = "3") int capacity,
            @Schema(description = "지금 인원(방장 포함)", example = "2") int participantCount) {}

    public record ParticipantResponse(
            @Schema(description = "회원 id", example = "3") long userId,
            @Schema(description = "닉네임", example = "면접왕") String nickname,
            @Schema(description = "프로필 사진 주소. 없으면 null", nullable = true) String profileImageUrl,
            JobCategory jobCategory,
            @Schema(description = "참가자의 면접 id", example = "55") long sessionId,
            PlanStatus planStatus,
            @Schema(description = "준비 완료", example = "true") boolean ready,
            @Schema(description = "답변 순서(1부터). 시작 전에는 null", nullable = true, example = "2")
                    Integer turnOrder,
            ParticipantState state) {}

    public record GroupResponse(
            @Schema(description = "그룹 id", example = "7") long groupId,
            GroupStatus status,
            InterviewMode mode,
            Persona persona,
            JobCategory jobCategory,
            @Schema(description = "정원 2 · 3", example = "3") int capacity,
            @Schema(
                            description = "초대 코드 6자리. WAITING일 때만, 그 밖에는 null",
                            nullable = true,
                            example = "K7Q2ZP")
                    String inviteCode,
            @Schema(description = "지금 방장", example = "3") long hostUserId,
            @Schema(description = "내 면접 id. 5.2 · 5.3 · 5.8 · 5.14 · 6.x에 쓴다", example = "55")
                    long mySessionId,
            @Schema(description = "나가지 않은 참가자를 들어온 순서로") List<ParticipantResponse> participants,
            @Schema(
                            description = "내 직군이 그룹 직군과 다르면 true. 10.3 응답에만 값이 있고, 그 외에는 null",
                            nullable = true)
                    Boolean jobCategoryMismatch) {}
}
