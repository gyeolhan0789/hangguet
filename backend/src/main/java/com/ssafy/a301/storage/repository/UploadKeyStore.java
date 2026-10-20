package com.ssafy.a301.storage.repository;

import com.ssafy.a301.storage.domain.UploadPurpose;
import java.time.Duration;

/** 업로드 주소를 누구에게 어떤 용도로 발급했는지 기록해, 등록 때 본인에게 발급된 키인지 확인한다. */
public interface UploadKeyStore {
    void issue(String objectKey, long userId, UploadPurpose purpose, Duration ttl);

    boolean isIssuedTo(String objectKey, long userId, UploadPurpose purpose);
}
