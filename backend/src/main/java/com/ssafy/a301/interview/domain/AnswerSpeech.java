package com.ssafy.a301.interview.domain;

/**
 * 화상 답변에서 에이전트가 실시간 음성으로 구한 말하기 지표(answers.speech, AI 명세 3장 표). 구하지 못한 값은 null이다.
 *
 * @param trailingOffRatio 말끝 흐림 비율(%)
 * @param pitchRangeSt 억양 폭(반음)
 */
public record AnswerSpeech(Double trailingOffRatio, Double pitchRangeSt) {}
