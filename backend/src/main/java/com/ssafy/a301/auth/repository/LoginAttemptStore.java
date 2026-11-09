package com.ssafy.a301.auth.repository;

import java.time.Duration;

/** 이메일별 로그인(1.3) 시도 횟수. 연속으로 틀리면 잠시 로그인을 막는다 */
public interface LoginAttemptStore {

    /**
     * 비밀번호를 확인하기 전에 시도 한 번을 센다. 잠겨 있으면 세지 않고 남은 시간을, 아니면 0을 준다. 세는 일과 잠김 확인을 한 번에 해서 동시에 보낸 요청이 제한을
     * 넘지 못한다
     */
    Duration tryAcquire(String email);

    /** 로그인 성공. 센 횟수를 지운다 */
    void reset(String email);
}
