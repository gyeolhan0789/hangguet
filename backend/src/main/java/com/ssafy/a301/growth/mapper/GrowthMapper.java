package com.ssafy.a301.growth.mapper;

import com.ssafy.a301.growth.dto.GrowthDtos.CriterionReview;
import com.ssafy.a301.growth.dto.GrowthDtos.Improvement;
import com.ssafy.a301.growth.dto.GrowthDtos.RecentReviewItem;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewSession;
import java.time.LocalDate;

/** 성장 리뷰 응답. 평균 점수·변화량은 계산값이라 서비스가 구해서 넘긴다. */
public final class GrowthMapper {

    private GrowthMapper() {}

    /**
     * @param comparedScore 직전 리뷰일의 같은 기준 평균 점수. 첫 리뷰일이면 null
     * @param comment 그날 마지막 면접의 기준 코멘트
     */
    public static CriterionReview toCriterionReview(
            Criterion criterion, int score, Integer comparedScore, String comment) {
        return new CriterionReview(
                criterion,
                score,
                Grade.of(score),
                comparedScore == null ? null : score - comparedScore,
                comment);
    }

    /**
     * @param lastSession 그날 마지막 결과 완료 면접
     * @param best 그날 가장 많이 오른 기준. 첫 리뷰일이거나 오른 기준이 없으면 null
     */
    public static RecentReviewItem toRecentReviewItem(
            LocalDate practiceDate, InterviewSession lastSession, Improvement best) {
        return new RecentReviewItem(
                practiceDate,
                lastSession.getApplication().getCompanyName(),
                best == null ? null : best.criterion(),
                best == null ? null : best.delta());
    }
}
