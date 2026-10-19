package com.ssafy.a301.auth;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.security.GeneralSecurityException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** 액세스 토큰(JWT, HS256)을 만든다. 목 서버는 토큰을 검사하지 않는다. */
@Component
public class JwtIssuer {

    private static final Base64.Encoder BASE64URL = Base64.getUrlEncoder().withoutPadding();
    private static final String HEADER =
            BASE64URL.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(UTF_8));

    private final ObjectMapper objectMapper;
    private final SecretKeySpec key;
    private final Duration accessTokenTtl;

    public JwtIssuer(
            ObjectMapper objectMapper,
            @Value("${mock.jwt.secret}") String secret,
            @Value("${mock.jwt.access-token-ttl}") Duration accessTokenTtl) {
        this.objectMapper = objectMapper;
        this.key = new SecretKeySpec(secret.getBytes(UTF_8), "HmacSHA256");
        this.accessTokenTtl = accessTokenTtl;
    }

    public String issueAccessToken(long userId, String nickname) {
        long now = Instant.now().getEpochSecond();
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("sub", String.valueOf(userId));
        claims.put("nickname", nickname);
        claims.put("iat", now);
        claims.put("exp", now + accessTokenTtl.toSeconds());
        String unsigned =
                HEADER + "." + BASE64URL.encodeToString(objectMapper.writeValueAsBytes(claims));
        return unsigned + "." + BASE64URL.encodeToString(sign(unsigned));
    }

    public long accessTokenTtlSeconds() {
        return accessTokenTtl.toSeconds();
    }

    private byte[] sign(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            return mac.doFinal(data.getBytes(UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("JWT 서명 실패", e);
        }
    }
}
