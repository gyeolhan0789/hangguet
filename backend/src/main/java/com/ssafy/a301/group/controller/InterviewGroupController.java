package com.ssafy.a301.group.controller;

import com.ssafy.a301.common.idempotency.Idempotent;
import com.ssafy.a301.common.web.CurrentUserId;
import com.ssafy.a301.group.dto.GroupDtos.GroupCreateRequest;
import com.ssafy.a301.group.dto.GroupDtos.GroupJoinRequest;
import com.ssafy.a301.group.dto.GroupDtos.GroupResponse;
import com.ssafy.a301.group.dto.GroupDtos.InviteResponse;
import com.ssafy.a301.group.dto.GroupDtos.ReadyRequest;
import com.ssafy.a301.group.service.InterviewGroupService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "10. 그룹 면접")
@RestController
@RequestMapping("/api/v1/interview-groups")
public class InterviewGroupController {
    private final InterviewGroupService groups;

    public InterviewGroupController(InterviewGroupService groups) {
        this.groups = groups;
    }

    @Operation(
            summary = "10.1 그룹 만들기",
            description =
                    "방장이 그룹을 만든다. 방장의 면접도 함께 만들고 개인 맞춤 질문 2개 생성을 시작한다(5.1과 같은 방식). 응답의 초대"
                            + " 코드로 다른 회원을 부른다.")
    @ApiResponse(responseCode = "201", description = "status WAITING, inviteCode 포함")
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: capacity가 2~3이 아님 등")
    @ApiResponse(responseCode = "404", description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 지운 지원서")
    @ApiResponse(
            responseCode = "409",
            description = "ALREADY_IN_GROUP: 대기 중이거나 진행 중인 다른 그룹에 있음 · IDEMPOTENCY_KEY_REUSED")
    @Idempotent
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GroupResponse create(
            @CurrentUserId long userId, @Valid @RequestBody GroupCreateRequest request) {
        return groups.create(userId, request);
    }

    @Operation(
            summary = "10.2 초대 확인",
            description = "초대 코드로 들어가기 전에 그룹을 보여 준다. 내 직군이 그룹 직군과 달라도 들어갈 수 있다.")
    @ApiResponse(responseCode = "404", description = "GROUP_NOT_FOUND: 없는 코드, 이미 시작했거나 취소된 그룹")
    @GetMapping("/invites/{inviteCode}")
    public InviteResponse invite(
            @Parameter(description = "초대 코드 6자리", example = "K7Q2ZP") @PathVariable
                    String inviteCode) {
        return groups.invite(inviteCode);
    }

    @Operation(
            summary = "10.3 그룹 참가",
            description = "초대 코드로 그룹에 들어간다. 내 면접을 만들고 개인 맞춤 질문 생성을 시작한다. 면접 방식 · 면접관은 그룹 값이다.")
    @ApiResponse(responseCode = "201", description = "그룹 응답 + jobCategoryMismatch")
    @ApiResponse(responseCode = "404", description = "GROUP_NOT_FOUND · APPLICATION_NOT_FOUND")
    @ApiResponse(
            responseCode = "409",
            description =
                    "GROUP_FULL: 정원이 참 · ALREADY_IN_GROUP: 이미 이 그룹이나 다른 그룹에 있음 ·"
                            + " IDEMPOTENCY_KEY_REUSED")
    @Idempotent
    @PostMapping("/join")
    @ResponseStatus(HttpStatus.CREATED)
    public GroupResponse join(
            @CurrentUserId long userId, @Valid @RequestBody GroupJoinRequest request) {
        return groups.join(userId, request);
    }

    @Operation(
            summary = "10.4 그룹 조회",
            description =
                    "대기실은 2초마다(임시 값, B-11) 부른다. 방장이 대기실 조회를 10초(임시 값) 넘게 멈추면 남은 참가자 중 가장 먼저 들어온"
                            + " 사람이 방장이 된다. 그룹이 WAITING이 아니게 되면 멈춘다.")
    @ApiResponse(responseCode = "404", description = "GROUP_NOT_FOUND: 없거나 참가자가 아님")
    @GetMapping("/{groupId}")
    public GroupResponse get(
            @CurrentUserId long userId,
            @Parameter(description = "그룹 id", example = "7") @PathVariable long groupId) {
        return groups.get(userId, groupId);
    }

    @Operation(summary = "10.5 준비·준비 취소", description = "화상은 장치 점검을 마친 뒤 부른다.")
    @ApiResponse(responseCode = "404", description = "GROUP_NOT_FOUND")
    @ApiResponse(
            responseCode = "409",
            description = "INVALID_GROUP_STATE: WAITING · START_FAILED가 아님")
    @PutMapping("/{groupId}/ready")
    public GroupResponse changeReady(
            @CurrentUserId long userId,
            @Parameter(description = "그룹 id", example = "7") @PathVariable long groupId,
            @Valid @RequestBody ReadyRequest request) {
        return groups.changeReady(userId, groupId, request.ready());
    }

    @Operation(
            summary = "10.6 그룹 나가기",
            description =
                    "대기실이나 시작 실패 상태에서 나간다. 내 면접은 시작하지 않은 채 남고 연습 기록에 들어가지 않는다. 방장이 나가면 남은 참가자 중"
                            + " 가장 먼저 들어온 사람이 방장이 된다. 진행 중에는 5.8로 끝낸다.")
    @ApiResponse(responseCode = "204", description = "나감")
    @ApiResponse(responseCode = "404", description = "GROUP_NOT_FOUND")
    @ApiResponse(responseCode = "409", description = "INVALID_GROUP_STATE: 진행 중이거나 끝남")
    @DeleteMapping("/{groupId}/participants/me")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leave(
            @CurrentUserId long userId,
            @Parameter(description = "그룹 id", example = "7") @PathVariable long groupId) {
        groups.leave(userId, groupId);
    }
}
