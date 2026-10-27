package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record EmailAvailabilityResponse(
        @Schema(description = "가입에 쓸 수 있으면 true. 사용 중이면 false(오류 아님)", example = "true")
                boolean available) {}
