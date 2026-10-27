package com.ssafy.a301.interview.repository;

import java.util.Map;

/** AI 분석 작업자에게 작업을 넘기는 큐. BE는 넣기만 한다. 메시지 형식은 AI 명세 1.3·2~4장. */
public interface AiJobQueue {
    void push(Map<String, Object> message);
}
