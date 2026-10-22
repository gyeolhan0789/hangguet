package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.AiJob;

/** AI 분석 작업자에게 작업을 넘기는 큐. BE는 넣기만 한다. */
public interface AiJobQueue {
    void push(AiJob job);
}
