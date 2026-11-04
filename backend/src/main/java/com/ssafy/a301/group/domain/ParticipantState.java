package com.ssafy.a301.group.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// API 명세 10장 그룹 응답 participants[].state
@Schema(
        description =
                "참가자 상태. WAITING 시작 전 · PRESENT 면접방에 있음 · ABSENT 진행 중 나감(2분 안에 돌아올 수 있음) · DONE 질문을"
                        + " 모두 마침 · ENDED 면접이 끝남")
public enum ParticipantState {
    WAITING,
    PRESENT,
    ABSENT,
    DONE,
    ENDED
}
