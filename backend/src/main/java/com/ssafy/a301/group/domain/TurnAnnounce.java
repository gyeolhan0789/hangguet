package com.ssafy.a301.group.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// API 명세 10.11 turn.announce
@Schema(description = "FULL 질문 전체를 말함 · CALL 같은 공통 질문의 다음 답변자 호명만")
public enum TurnAnnounce {
    FULL,
    CALL
}
