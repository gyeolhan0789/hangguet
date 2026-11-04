package com.ssafy.a301.group.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// docs/그룹면접-설계.md 5.1
@Schema(
        description =
                "그룹 상태. WAITING 대기실 · IN_PROGRESS 진행 중 · START_FAILED 시작 실패(방장이 다시 시작) · ENDED 끝남 ·"
                        + " CANCELLED 취소(모두 나감 · 만든 지 1시간)")
public enum GroupStatus {
    WAITING,
    IN_PROGRESS,
    START_FAILED,
    ENDED,
    CANCELLED;

    /** 대기실 화면에 있는 상태. 준비 · 나가기를 할 수 있다 */
    public boolean isLobby() {
        return this == WAITING || this == START_FAILED;
    }
}
