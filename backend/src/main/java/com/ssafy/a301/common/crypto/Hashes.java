package com.ssafy.a301.common.crypto;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** SHA-256 hex. 토큰 원문을 Redis 키에 남기지 않을 때와 멱등성 요청 지문에 쓴다 */
public final class Hashes {
    private Hashes() {}

    public static String sha256Hex(String text) {
        return sha256Hex(text.getBytes(StandardCharsets.UTF_8));
    }

    /** 이어 붙인 값의 해시. 따로 이어 붙이지 않아도 결과가 같다 */
    public static String sha256Hex(byte[]... parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (byte[] part : parts) {
                digest.update(part);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
