package com.ssafy.a301.admin.config;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * 관리자 비밀번호 해시(ERD admins.password_hash: BCrypt). 회원용 PasswordEncoder 빈(PBKDF2)과 섞이지 않도록
 * PasswordEncoder 타입 빈으로 두지 않는다.
 */
@Component
public class AdminPasswordEncoder {
    private final BCryptPasswordEncoder delegate = new BCryptPasswordEncoder();

    public String encode(String password) {
        return delegate.encode(password);
    }

    public boolean matches(String password, String hash) {
        return delegate.matches(password, hash);
    }
}
