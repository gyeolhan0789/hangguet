package com.ssafy.a301.common.idempotency;

/**
 * 멱등 키 하나의 기록. 처리 중이면 요청 지문만 있고, 끝나면 처음 성공 응답을 함께 담는다.
 *
 * @param fingerprint 요청 지문(메서드·경로·본문의 SHA-256). 같은 키로 다른 요청이 왔는지 가린다
 * @param status 응답 상태 코드. 처리 중이면 null
 * @param contentType 응답 Content-Type. 본문이 없으면 null
 * @param body 응답 본문. 본문이 없으면 빈 문자열
 */
public record IdempotencyRecord(
        String fingerprint, Integer status, String contentType, String body) {

    public static IdempotencyRecord processing(String fingerprint) {
        return new IdempotencyRecord(fingerprint, null, null, null);
    }

    public static IdempotencyRecord completed(
            String fingerprint, int status, String contentType, String body) {
        return new IdempotencyRecord(fingerprint, status, contentType, body);
    }

    public boolean isCompleted() {
        return status != null;
    }
}
