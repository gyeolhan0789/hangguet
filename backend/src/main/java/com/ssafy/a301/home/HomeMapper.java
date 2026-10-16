package com.ssafy.a301.home;

import com.ssafy.a301.home.HomeDtos.PracticeLogItem;
import com.ssafy.a301.home.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.home.domain.PracticeLog;
import java.util.Comparator;
import java.util.List;

/** 연습 기록 엔티티 → 연습 달력 응답. 홈·통계·성장 리뷰는 계산값이라 서비스가 만든다. */
public final class HomeMapper {

    private HomeMapper() {}

    public static PracticeLogsResponse toPracticeLogs(List<PracticeLog> logs) {
        return new PracticeLogsResponse(
                logs.stream()
                        .sorted(Comparator.comparing(PracticeLog::getPracticeDate))
                        .map(l -> new PracticeLogItem(l.getPracticeDate(), l.getCreatedAt()))
                        .toList());
    }
}
