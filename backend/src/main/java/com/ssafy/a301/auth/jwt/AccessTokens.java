package com.ssafy.a301.auth.jwt;

import java.time.Instant;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Component;

@Component
public class AccessTokens {
    private final JwtEncoder encoder;
    private final AuthProperties properties;

    public AccessTokens(JwtEncoder encoder, AuthProperties properties) {
        this.encoder = encoder;
        this.properties = properties;
    }

    public String issue(long userId, String nickname) {
        Instant now = Instant.now();
        var claims =
                JwtClaimsSet.builder()
                        .issuer("a301")
                        .subject(Long.toString(userId))
                        .claim("nickname", nickname)
                        .issuedAt(now)
                        .expiresAt(now.plus(properties.accessTtl()))
                        .build();
        return encoder.encode(
                        JwtEncoderParameters.from(
                                JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();
    }
}
