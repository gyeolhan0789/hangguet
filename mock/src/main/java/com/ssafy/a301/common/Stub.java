package com.ssafy.a301.common;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

// 뼈대 단계 전용: 명세 예시 JSON을 그대로 응답 객체로 바꾼다. 실제 로직이 들어오면 지운다.
@Component
public class Stub {

    private final ObjectMapper objectMapper;

    public Stub(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public <T> T read(String json, Class<T> type) {
        return objectMapper.readValue(json, type);
    }

    public <T> T read(String json, TypeReference<T> type) {
        return objectMapper.readValue(json, type);
    }

    // 경로 id가 0이면 해당 404 (화면 오류 처리 확인용)
    public static void notFoundIfZero(long id, ErrorCode code) {
        if (id == 0) {
            throw new ApiException(code);
        }
    }
}
