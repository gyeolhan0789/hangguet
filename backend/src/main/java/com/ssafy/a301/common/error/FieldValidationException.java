package com.ssafy.a301.common.error;

/** 필드 사이 조건처럼 어노테이션으로 걸 수 없는 검증 실패. 400 VALIDATION_FAILED + errors로 응답한다. */
public class FieldValidationException extends RuntimeException {

    private final String field;
    private final String reason;

    public FieldValidationException(String field, String reason) {
        super(field + ": " + reason);
        this.field = field;
        this.reason = reason;
    }

    public String field() {
        return field;
    }

    public String reason() {
        return reason;
    }
}
