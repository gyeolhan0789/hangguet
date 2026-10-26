package com.ssafy.a301.inquiry.crypto;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 문의 제목 · 본문 암호화(AES-256-GCM). 키는 환경 변수 INQUIRY_ENCRYPTION_KEY(Base64, 32바이트)로만 받고, 없거나 길이가 다르면
 * 기동하지 않는다. 저장 값 = Base64(IV 12바이트 + 암호문 + 인증 태그 16바이트). 같은 글도 IV가 매번 달라 암호문이 다르다. 키를 잃으면 저장한 문의는 풀
 * 수 없다.
 */
@Component
public class InquiryCipher {
    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int KEY_BYTES = 32;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecretKey key;
    private final SecureRandom random = new SecureRandom();

    public InquiryCipher(@Value("${inquiry.encryption-key}") String base64Key) {
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(base64Key.trim());
        } catch (IllegalArgumentException ex) {
            throw new IllegalStateException("INQUIRY_ENCRYPTION_KEY는 Base64여야 합니다.", ex);
        }
        if (raw.length != KEY_BYTES) {
            throw new IllegalStateException("INQUIRY_ENCRYPTION_KEY는 32바이트(AES-256)여야 합니다.");
        }
        this.key = new SecretKeySpec(raw, "AES");
    }

    public String encrypt(String plain) {
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        try {
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder()
                    .encodeToString(
                            ByteBuffer.allocate(IV_BYTES + sealed.length)
                                    .put(iv)
                                    .put(sealed)
                                    .array());
        } catch (GeneralSecurityException ex) {
            throw new IllegalStateException("문의 내용을 암호화하지 못했습니다.", ex);
        }
    }

    public String decrypt(String stored) {
        try {
            byte[] all = Base64.getDecoder().decode(stored);
            if (all.length <= IV_BYTES) {
                throw new IllegalArgumentException("암호문이 너무 짧습니다.");
            }
            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
            return new String(
                    cipher.doFinal(all, IV_BYTES, all.length - IV_BYTES), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException ex) {
            // 키가 바뀌었거나 저장 값이 손상됐다
            throw new IllegalStateException("문의 내용을 복호화하지 못했습니다.", ex);
        }
    }
}
