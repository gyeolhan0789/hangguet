package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 화상 면접 동시 진행 상한(BE 설계 5.2). 화상 면접은 에이전트가 답변마다 Soniox 실시간 인식 연결을 하나 연다. 연결 한도는 계정당 10개이고 개발 · 운영이
 * 같은 키를 쓰므로, 상한을 넘는 시작(5.4 · 10.7)은 503 INTERVIEW_CAPACITY_FULL로 막는다.
 *
 * <p>진행 중인 화상 면접을 센다. 그룹은 답변자 한 명만 인식하므로 하나로 센다(AI 명세 6.7). 화면을 닫고 떠난 면접은 IN_PROGRESS로 남으므로 최근에 시작한
 * 면접만 센다.
 */
@Component
public class InterviewCapacity {
    // 화상 면접 시작을 한 번에 하나씩 통과시키는 트랜잭션 잠금(pg_advisory_xact_lock) 키. 다른 잠금과 겹치지 않는 임의 값
    private static final long START_LOCK_KEY = 401_001L;

    private final InterviewSessionRepository sessions;
    private final JdbcTemplate jdbc;
    private final int maxVideo;
    private final Duration countWindow;

    public InterviewCapacity(
            InterviewSessionRepository sessions,
            JdbcTemplate jdbc,
            @Value("${interview.capacity.max-video:8}") int maxVideo,
            @Value("${interview.capacity.count-window:90m}") Duration countWindow) {
        this.sessions = sessions;
        this.jdbc = jdbc;
        this.maxVideo = maxVideo;
        this.countWindow = countWindow;
    }

    /**
     * 화상 면접 하나를 더 시작할 수 있는지 확인한다. 면접(그룹은 그룹 · 면접) 행을 잠근 트랜잭션 안에서, 면접을 IN_PROGRESS로 바꾸기 직전에 부른다. 잠금은
     * 커밋 · 롤백까지 유지되므로 동시에 들어온 시작이 같은 빈자리로 함께 통과하지 않는다. 이 잠금은 항상 마지막에 잡는다(교착 방지).
     */
    public void reserveVideo(OffsetDateTime now) {
        jdbc.query("select pg_advisory_xact_lock(?)", rs -> null, START_LOCK_KEY);
        if (sessions.countRunningVideo(now.minus(countWindow)) >= maxVideo) {
            throw new ApiException(ErrorCode.INTERVIEW_CAPACITY_FULL);
        }
    }
}
