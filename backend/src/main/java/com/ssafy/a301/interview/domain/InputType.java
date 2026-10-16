package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "답변 입력 방식. VOICE 화상(음성) · TEXT 채팅")
public enum InputType {
    VOICE,
    TEXT
}
