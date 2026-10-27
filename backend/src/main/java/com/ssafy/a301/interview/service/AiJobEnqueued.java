package com.ssafy.a301.interview.service;

import java.util.UUID;

/** Outbox에 AI 작업을 넣었다. 커밋된 뒤에 큐로 보낸다. */
public record AiJobEnqueued(UUID jobId) {}
