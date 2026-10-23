package com.ssafy.a301.admin.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** 기동할 때 만들 관리자 계정(환경 변수 ADMIN_LOGIN_ID · ADMIN_PASSWORD · ADMIN_NAME). 하나라도 비면 만들지 않는다. */
@ConfigurationProperties("admin.bootstrap")
public record AdminProperties(String loginId, String password, String name) {
    public boolean isComplete() {
        return hasText(loginId) && hasText(password) && hasText(name);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
