package com.ssafy.a301.group.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// docs/그룹면접-설계.md 5.2, API 명세 10.11
@Schema(
        description =
                "진행 단계. ASKING 질문 준비 · SPEAKING 질문 음성 중(입력 잠금) · ANSWERING 답변 중 · DECIDING 꼬리질문 판단"
                        + " 중 · WAITING 이탈한 참가자 재접속 대기")
public enum GroupPhase {
    ASKING,
    SPEAKING,
    ANSWERING,
    DECIDING,
    WAITING
}
