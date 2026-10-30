package com.ssafy.a301.company.service;

import com.ssafy.a301.company.config.CompanyCardProperties;
import java.util.Optional;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;

/** 공용 버킷(company-card.bucket)의 파일을 읽는다. 자격 증명은 앱 키(AWS 기본 공급자)를 쓴다. */
@Component
public class CompanyCardSource {
    public static final String MANIFEST = "manifest.json";

    private final S3Client s3;
    private final CompanyCardProperties properties;

    public CompanyCardSource(S3Client s3, CompanyCardProperties properties) {
        this.s3 = s3;
        this.properties = properties;
    }

    /** 파일이 없으면 empty */
    public Optional<byte[]> read(String key) {
        try {
            return Optional.of(
                    s3.getObjectAsBytes(request -> request.bucket(properties.bucket()).key(key))
                            .asByteArray());
        } catch (NoSuchKeyException ex) {
            return Optional.empty();
        }
    }
}
