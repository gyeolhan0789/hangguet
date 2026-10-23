package com.ssafy.a301.admin.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "배포 대상. ALL 전체 회원 · USERS 지정 회원")
public enum GrantTarget {
    ALL,
    USERS
}
