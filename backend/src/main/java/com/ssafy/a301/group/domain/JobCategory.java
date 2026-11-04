package com.ssafy.a301.group.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// 그룹 직군 대분류. 지원서 직무는 자유 글이라 자동 분류하지 않고 방장 · 참가자가 고른다. 값 목록은 확정 전이다(API 명세 B-21)
@Schema(
        description =
                "직군 대분류(값 목록은 B-21에서 확정). DEVELOPMENT 개발 · DATA_AI 데이터·AI · DESIGN 디자인 · PLANNING"
                        + " 기획 · MARKETING 마케팅 · SALES 영업 · MANAGEMENT_SUPPORT 경영지원 · ETC 기타")
public enum JobCategory {
    DEVELOPMENT,
    DATA_AI,
    DESIGN,
    PLANNING,
    MARKETING,
    SALES,
    MANAGEMENT_SUPPORT,
    ETC
}
