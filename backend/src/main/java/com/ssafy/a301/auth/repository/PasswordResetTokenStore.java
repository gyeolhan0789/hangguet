package com.ssafy.a301.auth.repository;

import java.time.Instant;

/** 비밀번호 재설정 링크(1.8 · 1.9) 토큰과 이메일별 재요청 간격 */
public interface PasswordResetTokenStore {

    /** 토큰 하나. issuedAt 뒤에 비밀번호가 바뀌었으면 쓸 수 없다 */
    record ResetToken(long userId, Instant issuedAt) {}

    /** 이메일로 재요청 간격을 시작한다. 간격 안에 다시 요청했으면 false(메일을 보내지 않음). 가입하지 않은 이메일도 같게 센다 */
    boolean tryStartResendInterval(String email);

    String issue(long userId);

    /** 토큰을 한 번만 쓰고 지운다. 없거나 만료됐거나 이미 썼으면 null */
    ResetToken consume(String token);
}
