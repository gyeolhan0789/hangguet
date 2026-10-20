package com.ssafy.a301.storage.s3;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("storage.s3")
public record S3Properties(
        String bucket, String region, Duration uploadUrlTtl, Duration downloadUrlTtl) {
    public S3Properties {
        if (bucket == null || bucket.isBlank() || region == null || region.isBlank()) {
            throw new IllegalArgumentException("S3 bucket and region are required");
        }
        if (uploadUrlTtl == null
                || uploadUrlTtl.isNegative()
                || uploadUrlTtl.isZero()
                || downloadUrlTtl == null
                || downloadUrlTtl.isNegative()
                || downloadUrlTtl.isZero()) {
            throw new IllegalArgumentException("Presigned URL lifetimes must be positive");
        }
    }
}
