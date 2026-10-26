package com.ssafy.a301.inquiry.crypto;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import org.springframework.stereotype.Component;

/** 엔티티의 글자 칸을 저장할 때 암호화하고 읽을 때 푼다(InquiryCipher). 문의 제목 · 메시지 본문에 쓴다. */
@Component
@Converter
public class EncryptedTextConverter implements AttributeConverter<String, String> {
    private final InquiryCipher cipher;

    public EncryptedTextConverter(InquiryCipher cipher) {
        this.cipher = cipher;
    }

    @Override
    public String convertToDatabaseColumn(String plain) {
        return plain == null ? null : cipher.encrypt(plain);
    }

    @Override
    public String convertToEntityAttribute(String stored) {
        return stored == null ? null : cipher.decrypt(stored);
    }
}
