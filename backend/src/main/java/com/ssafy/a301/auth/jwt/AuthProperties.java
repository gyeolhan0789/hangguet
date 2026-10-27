package com.ssafy.a301.auth.jwt;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("auth")
public record AuthProperties(String jwtSecret, Duration accessTtl, Duration refreshTtl) {
    public AuthProperties {
        if (jwtSecret == null
                || jwtSecret.getBytes(java.nio.charset.StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("JWT_SECRET must contain at least 32 bytes");
        }
        if (accessTtl == null
                || accessTtl.isNegative()
                || accessTtl.isZero()
                || refreshTtl == null
                || refreshTtl.isNegative()
                || refreshTtl.isZero()) {
            throw new IllegalArgumentException("Token lifetimes must be positive");
        }
    }
}
