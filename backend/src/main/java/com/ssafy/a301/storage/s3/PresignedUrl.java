package com.ssafy.a301.storage.s3;

import java.time.OffsetDateTime;

/** 브라우저가 S3에 직접 올리거나 받을 때 쓰는 임시 주소 */
public record PresignedUrl(String url, OffsetDateTime expiresAt) {}
