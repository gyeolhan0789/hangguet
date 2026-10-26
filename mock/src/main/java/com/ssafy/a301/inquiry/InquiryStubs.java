package com.ssafy.a301.inquiry;

import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;

// 뼈대 단계 전용: 화면 오류 처리 확인용 id 규칙. 실제 로직이 들어오면 지운다.
final class InquiryStubs {

    /** 종료한 문의로 보는 id */
    static final long CLOSED_INQUIRY_ID = 4;

    private InquiryStubs() {}

    // 0이면 404, 4면 종료한 문의라 409
    static void closedOr404(long inquiryId) {
        Stub.notFoundIfZero(inquiryId, ErrorCode.INQUIRY_NOT_FOUND);
        if (inquiryId == CLOSED_INQUIRY_ID) {
            throw new ApiException(ErrorCode.INQUIRY_CLOSED);
        }
    }
}
