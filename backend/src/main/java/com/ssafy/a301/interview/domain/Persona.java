package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "면접관. DEVIL 악마 면접관 · COFFEE_CHAT 개발자 커피챗 · DUCK 오리 면접관")
public enum Persona {
    DEVIL,
    COFFEE_CHAT,
    DUCK
}
