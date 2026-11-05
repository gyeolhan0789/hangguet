package com.ssafy.a301.group.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// API 명세 10.11 turn.kind
@Schema(description = "질문 종류. COMMON 공통 · PERSONAL 개인 맞춤 · FOLLOWUP 꼬리질문")
public enum TurnKind {
    COMMON,
    PERSONAL,
    FOLLOWUP
}
