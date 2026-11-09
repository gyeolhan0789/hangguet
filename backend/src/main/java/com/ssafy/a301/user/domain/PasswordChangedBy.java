package com.ssafy.a301.user.domain;

/** 비밀번호를 바꾼 주체. ADMIN 관리자가 문의를 보고 바꿔 줌 · USER 회원이 직접 바꿈 · RESET 회원이 비밀번호 찾기 메일 링크로 바꿈 */
public enum PasswordChangedBy {
    ADMIN,
    USER,
    RESET
}
