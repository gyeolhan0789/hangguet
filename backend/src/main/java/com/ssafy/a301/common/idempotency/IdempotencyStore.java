package com.ssafy.a301.common.idempotency;

import java.util.UUID;

/** 회원별 멱등 키 기록. 다른 회원이 같은 키를 써도 서로 영향이 없다. */
public interface IdempotencyStore {

    /**
     * 처리 중 표시를 잡는다. 잡으면 null, 이미 기록이 있으면 그 기록을 돌려준다.
     *
     * @param fingerprint 이번 요청의 지문
     */
    IdempotencyRecord begin(long userId, UUID key, String fingerprint);

    /** 처리가 끝난 응답을 저장한다. 같은 키의 재요청은 이 응답을 받는다. */
    void complete(long userId, UUID key, IdempotencyRecord stored);

    /** 처리에 실패해 같은 키로 다시 시도할 수 있게 처리 중 표시를 지운다. 끝난 기록은 지우지 않는다. */
    void release(long userId, UUID key, String fingerprint);
}
