package com.ssafy.a301.storage.repository;

import com.ssafy.a301.storage.domain.UploadPurpose;
import java.time.Duration;

/** 업로드 주소를 누구에게 어떤 용도로 발급했는지 기록해, 등록 때 본인에게 발급된 키인지 확인한다. */
public interface UploadKeyStore {
    void issue(String objectKey, long userId, UploadPurpose purpose, Duration ttl);

    boolean isIssuedTo(String objectKey, long userId, UploadPurpose purpose);

    /** 받는 사람을 정하지 않고 발급한다(비회원도 쓰는 문의 첨부). 키를 아는 사람이 한 번만 쓸 수 있다. */
    void issueOnce(String objectKey, UploadPurpose purpose, Duration ttl);

    /** issueOnce로 발급했고 아직 쓰지 않은 키인지 */
    boolean isIssued(String objectKey, UploadPurpose purpose);

    /** 발급 기록을 지우며 쓴다. 이미 썼거나 만료됐으면 false */
    boolean use(String objectKey, UploadPurpose purpose);
}
