package com.ssafy.a301.alarm.kakao;

/** 카카오 API 실패. kind로 다시 시도할지, 알림을 끌지 정한다 */
public class KakaoApiException extends RuntimeException {
    public enum Kind {
        /** 액세스 토큰 만료 · 무효(401). 리프레시 토큰으로 새로 받아 다시 보낸다 */
        TOKEN_EXPIRED,
        /** 인가 코드 · 리프레시 토큰이 쓸 수 없거나 회원이 동의를 철회했다. 다시 동의해야 한다 */
        REJECTED,
        /** 카카오 서버 오류 · 시간 초과 · 우리 앱 설정 오류. 나중에 다시 할 수 있다 */
        UNAVAILABLE
    }

    private final Kind kind;

    public KakaoApiException(Kind kind, String message) {
        super(message);
        this.kind = kind;
    }

    public Kind kind() {
        return kind;
    }
}
