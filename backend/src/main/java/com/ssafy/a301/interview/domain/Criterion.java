package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

@Schema(
        description =
                "평가 기준. 화면 이름: JOB_FIT 직무 적합성 · COVER_LETTER 자소서 검증 · LOGIC 논리성 · DELIVERY 전달력")
public enum Criterion {
    JOB_FIT,
    COVER_LETTER,
    LOGIC,
    DELIVERY;

    /**
     * 기준 4개가 하나씩 다 있는지. 면접 결과(session_scores)는 기준 4개가 모두 있어야 완전하다(결과 저장 검사·5.13·6.3·7.x). 빠지거나 겹치거나
     * null이 있으면 false
     */
    public static boolean coversAllOnce(Collection<Criterion> criteria) {
        Set<Criterion> distinct = new HashSet<>(criteria);
        return criteria.size() == values().length
                && distinct.size() == values().length
                && !distinct.contains(null);
    }
}
