package com.ssafy.a301.group.repository;

/** 처리한 LiveKit 웹훅 이벤트 id. 같은 이벤트를 한 번만 처리한다(docs/그룹면접-설계.md 4.4 · 6.9) */
public interface WebhookEventStore {
    /**
     * @return 처음 받은 이벤트면 true
     */
    boolean markNew(String eventId);

    /** 처리하지 못한 이벤트를 다시 받을 수 있게 지운다 */
    void forget(String eventId);
}
