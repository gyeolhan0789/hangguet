package com.ssafy.a301.group.dto;

import com.ssafy.a301.group.domain.GroupPhase;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.JobCategory;
import com.ssafy.a301.group.domain.ParticipantState;
import com.ssafy.a301.group.domain.TurnAnnounce;
import com.ssafy.a301.group.domain.TurnKind;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.OffsetDateTime;
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
                    Boolean jobCategoryMismatch,
            @Schema(description = "진행 중이면 면접방 정보(10.11)와 같은 차례 정보, 그 밖에는 null", nullable = true)
                    RoomInfo turn,
            @Schema(
                            description = "방장의 면접방 입장 정보(5.14와 같은 형식). 10.7 응답에만 값이 있고, 그 외에는 null",
                            nullable = true)
                    RoomResponse room) {}

    /** 10.8 답변 시간 연장 응답 */
    public record ExtendResponse(@Schema(description = "늘어난 답변 마감") OffsetDateTime deadlineAt) {}

    /** 면접방 정보(LiveKit room metadata, API 명세 10.11). BE만 쓰고 화면 · 에이전트는 읽는다. 10.4 turn도 같은 형식이다 */
    public record RoomInfo(
            @Schema(description = "바뀔 때마다 1씩 는다. 가진 값보다 작거나 같으면 버린다", example = "17")
                    int turnVersion,
            @Schema(description = "이 정보를 만든 BE 시각. 화면은 자기 시계와의 차이로 deadlineAt을 보정한다")
                    OffsetDateTime serverTime,
            GroupStatus groupStatus,
            @Schema(description = "현재 라운드 1~4", example = "2") int round,
            @Schema(description = "진행 단계. 남은 질문이 없으면 null", nullable = true) GroupPhase phase,
            @Schema(description = "지금 차례. 남은 질문이 없으면(모두 DONE · ENDED) null", nullable = true)
                    TurnInfo turn,
            List<RoomParticipant> participants,
            @Schema(description = "이 라운드에서 지금 답변자 다음에 답할 면접 id 순서", example = "[56, 57]")
                    List<Long> upcoming) {}

    public record TurnInfo(
            @Schema(description = "지금 답변자의 면접 id", example = "55") long sessionId,
            @Schema(description = "그 면접 안의 질문 순서 1~6", example = "3") int seq,
            TurnKind kind,
            @Schema(
                            description = "몇 번째 기본 질문인지(1 공통 · 2 개인 · 3 공통 · 4 개인). 꼬리질문은 null",
                            nullable = true,
                            example = "2")
                    Integer baseIndex,
            TurnAnnounce announce,
            @Schema(description = "답변 마감. ANSWERING에서만, 그 밖에는 null", nullable = true)
                    OffsetDateTime deadlineAt,
            @Schema(description = "이 질문에서 답변 시간을 연장했는지", example = "false") boolean extended,
            @Schema(description = "이 답변자가 더 받을 수 있는 꼬리질문 수 0~2(끝낸 꼬리질문을 뺀 수)", example = "2")
                    int followupsLeft) {}

    public record RoomParticipant(
            @Schema(description = "면접 id", example = "55") long sessionId,
            @Schema(description = "답변 순서(1부터)", example = "1") int turnOrder,
            ParticipantState state,
            @Schema(description = "ABSENT일 때 이 시각까지 다시 들어올 수 있다. 그 밖에는 null", nullable = true)
                    OffsetDateTime absentUntil,
            @Schema(
                            description =
                                    "ENDED일 때 끝난 이유 ALL_ANSWERED · USER_ENDED · DISCONNECTED ·"
                                            + " AI_FAILURE · CLEANUP. 그 밖에는 null",
                            nullable = true)
                    String endReason) {}
}
