package com.ssafy.a301.inquiry;

import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import java.util.List;

// 뼈대 단계 전용: 화면 오류 처리 확인용 id 규칙. 실제 로직이 들어오면 지운다.
final class InquiryStubs {

    /** 종료한 문의로 보는 id */
    static final long CLOSED_INQUIRY_ID = 4;

    /** 이미 쓴 키로 보는 사진 키 */
    static final String USED_KEY = "inquiry/used.png";

    /** S3에 아직 올리지 않은 것으로 보는 사진 키 */
    static final String MISSING_KEY = "inquiry/missing.png";

    private InquiryStubs() {}

    // 이미 쓴 키면 400, 올리지 않은 사진이면 404
    static void attachmentKeys(List<String> keys) {
        if (keys == null) {
            return;
        }
        if (keys.contains(USED_KEY)) {
            throw new FieldValidationException("attachmentKeys", "발급되지 않았거나 이미 쓴 키입니다.");
        }
        if (keys.contains(MISSING_KEY)) {
            throw new ApiException(ErrorCode.FILE_NOT_FOUND);
        }
    }

    // 0이면 404, 4면 종료한 문의라 409
    static void closedOr404(long inquiryId) {
        Stub.notFoundIfZero(inquiryId, ErrorCode.INQUIRY_NOT_FOUND);
        if (inquiryId == CLOSED_INQUIRY_ID) {
            throw new ApiException(ErrorCode.INQUIRY_CLOSED);
        }
    }
}
