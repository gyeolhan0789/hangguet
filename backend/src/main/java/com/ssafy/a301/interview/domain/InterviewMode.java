package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "면접 방식. VIDEO 화상 · CHAT 채팅")
public enum InterviewMode {
    VIDEO,
    CHAT
}
