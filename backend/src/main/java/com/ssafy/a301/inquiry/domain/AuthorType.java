package com.ssafy.a301.inquiry.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "메시지를 쓴 사람. USER 문의한 사람 · ADMIN 관리자")
public enum AuthorType {
    USER,
    ADMIN
}
