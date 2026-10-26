package com.ssafy.a301.inquiry.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "문의 상태. WAITING 답변 대기 · ANSWERED 답변함 · CLOSED 종료")
public enum InquiryStatus {
    WAITING,
    ANSWERED,
    CLOSED
}
