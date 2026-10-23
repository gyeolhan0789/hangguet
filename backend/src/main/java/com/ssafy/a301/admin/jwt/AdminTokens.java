package com.ssafy.a301.admin.jwt;

import com.ssafy.a301.auth.jwt.AuthProperties;
import java.time.Instant;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

/**
 * 관리자 액세스 토큰(8.1). 회원 토큰과 같은 키·유효 시간(auth.access-ttl)을 쓰고 발급자(iss)를 a301-admin으로 구분한다. 회원 API는 발급자
 * a301만, 관리 API는 a301-admin만 받는다. 재발급은 없다.
 */
@Component
public class AdminTokens {
    public static final String ISSUER = "a301-admin";

    private final JwtEncoder encoder;
    private final AuthProperties properties;

    public AdminTokens(JwtEncoder encoder, AuthProperties properties) {
        this.encoder = encoder;
        this.properties = properties;
    }

    public String issue(long adminId, String name) {
        Instant now = Instant.now();
        var claims =
                JwtClaimsSet.builder()
                        .issuer(ISSUER)
                        .subject(Long.toString(adminId))
                        .claim("name", name)
                        .issuedAt(now)
                        .expiresAt(now.plus(properties.accessTtl()))
                        .build();
        return encoder.encode(
                        JwtEncoderParameters.from(
                                JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();
    }

    public long ttlSeconds() {
        return properties.accessTtl().toSeconds();
    }
}
