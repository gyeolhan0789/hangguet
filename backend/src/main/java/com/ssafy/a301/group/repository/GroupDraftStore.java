package com.ssafy.a301.group.repository;

import java.util.Optional;

/**
 * 채팅 그룹 면접의 작성 중인 글(10.9, docs/그룹면접-설계.md 6.7). 최종 답변이 아니고 마감 때 최종 답변으로 확정하는 재료일 뿐이다. 질문마다 따로 둬 다른
 * 질문의 글과 섞이지 않는다.
 */
public interface GroupDraftStore {
    /** 덮어쓴다 */
    void save(long sessionId, long questionId, String content);

    Optional<String> find(long sessionId, long questionId);

    /** 최종 답변을 확정했거나 질문이 닫혔거나 면접이 끝났다 */
    void delete(long sessionId, long questionId);
}
