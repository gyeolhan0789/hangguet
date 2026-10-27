package com.ssafy.a301.interview.repository;

import java.time.Duration;
import java.util.List;
import java.util.Optional;

/** AI가 보낸 결과 메시지 큐(AI 명세 1.4). 꺼낸 메시지는 처리를 끝낼 때까지 처리 중 목록에 남아, BE가 멈춰도 다시 처리할 수 있다. */
public interface AiResultQueue {

    /** 메시지 하나를 처리 중 목록으로 옮겨 꺼낸다. timeout 동안 없으면 비어 있다. */
    Optional<String> take(Duration timeout);

    /** 처리 중 목록에 남은 메시지(오래된 순). BE가 처리 도중 멈췄을 때 다시 처리한다. */
    List<String> processing();

    /** 처리를 끝낸(저장했거나 버린) 메시지를 처리 중 목록에서 지운다. */
    void done(String message);

    /** 다시 처리해도 안 되는 메시지를 실패 목록으로 옮긴다. */
    void fail(String message);
}
