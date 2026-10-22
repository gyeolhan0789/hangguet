package com.ssafy.a301.interview.domain;

/**
 * 화상 답변에서 음성 인식이 확정한 토큰(answers.tokens 원소). 5.7 요청의 tokens를 그대로 저장하고 AI가 말하기 지표를 구할 때 읽는다.
 *
 * @param text 토큰 글자. 단어 일부·공백일 수 있다
 * @param startMs 말하기 시작한 시각(밀리초). 답변 음성 파일 시작 기준
 * @param endMs 말하기 끝낸 시각(밀리초)
 */
public record AnswerToken(String text, int startMs, int endMs) {}
