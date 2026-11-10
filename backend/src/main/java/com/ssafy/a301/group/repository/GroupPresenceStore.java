package com.ssafy.a301.group.repository;

import java.time.Instant;
import java.util.Optional;

/** 대기실 접속 시각. 방장이 대기실 조회를 멈췄는지 보고 방장을 넘기는 데 쓴다(docs/그룹면접-설계.md 6.1). 잃어도 다음 조회로 다시 채워진다. */
public interface GroupPresenceStore {
    void markSeen(long groupId, long userId, Instant now);

    /** 기록이 없을 때만 남긴다 */
    void recordIfAbsent(long groupId, long userId, Instant now);

    Optional<Instant> lastSeen(long groupId, long userId);

    void remove(long groupId, long userId);
}
