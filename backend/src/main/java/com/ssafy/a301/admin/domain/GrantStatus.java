package com.ssafy.a301.admin.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "배포 상태. SCHEDULED 지급 전 · GRANTED 지급함")
public enum GrantStatus {
    SCHEDULED,
    GRANTED
}
