package com.ssafy.a301.interview.domain;

import java.util.List;

/**
 * 화상 답변을 듣는 동안 카메라 사진으로 1초마다 판단한 인상(answers.speech.impressions, AI 명세 6.6). 다시보기 타임라인용이다.
 *
 * @param promptVersion 판단 질문 버전
 * @param modelVersion 판단한 Jev 모델
 * @param items 사진마다의 판단. 찍은 시각 순
 */
public record AnswerImpressions(String promptVersion, String modelVersion, List<Item> items) {

    /**
     * 사진 한 장의 판단. 측정값 그대로이고, 얼굴로 볼 기준(face 0.5)은 쓰는 쪽에서 적용한다. 받지 못한 점수는 null이다.
     *
     * @param atMs 찍은 시각(답변 시작 기준 밀리초)
     * @param face 실제 사람 얼굴 확률(0~1)
     * @param stability 안정감(0~100)
     * @param confidence 자신감(0~100)
     * @param expression 의사표현(0~100)
     * @param emotion 감정 전달(0~100)
     * @param likeability 매력도(0~100)
     * @param trust 신뢰도(0~100)
     */
    public record Item(
            Integer atMs,
            Double face,
            Double stability,
            Double confidence,
            Double expression,
            Double emotion,
            Double likeability,
            Double trust) {}
}
