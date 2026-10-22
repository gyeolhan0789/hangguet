package com.ssafy.a301.common.idempotency;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Idempotency-Key 헤더가 필요한 API(5.1·5.4·5.7·5.8). 같은 키·같은 요청이면 처음 성공 응답을 그대로 돌려주고, 같은 키·다른 요청이거나 아직
 * 처리 중이면 409 IDEMPOTENCY_KEY_REUSED, 헤더가 없거나 UUID가 아니면 400 VALIDATION_FAILED로 응답한다.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Idempotent {
    String HEADER = "Idempotency-Key";
}
