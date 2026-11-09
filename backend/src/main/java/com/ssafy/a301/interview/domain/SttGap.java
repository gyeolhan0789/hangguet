package com.ssafy.a301.interview.domain;

/**
 * 화상 답변에서 STT 연결이 끊겨 음성을 인식하지 못한 구간(answers.stt_gaps 원소, AI 명세 6.2 sttGaps). 채점 · 결과 생성이 이 구간을 지원자의
 * 멈춤 · 반복과 구분한다(AI 명세 3 · 4장).
 *
 * @param startMs 끊긴 연결에서 마지막으로 응답을 받은 시각(밀리초). 답변을 듣기 시작한 시각(answers.started_at) 기준
 * @param endMs 음성 전송을 다시 시작한 시각, 다시 연결하지 못했으면 답변을 끝낸 시각(밀리초)
 */
public record SttGap(int startMs, int endMs) {}
