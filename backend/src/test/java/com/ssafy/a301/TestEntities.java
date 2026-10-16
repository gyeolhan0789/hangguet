package com.ssafy.a301;

import java.time.OffsetDateTime;
import org.springframework.test.util.ReflectionTestUtils;

/** DB 없이 엔티티를 만들 때 DB가 채우는 id·생성 일시를 넣어 준다. */
public final class TestEntities {

    public static final OffsetDateTime T0 = OffsetDateTime.parse("2026-10-15T12:00:00+09:00");

    private TestEntities() {}

    public static <T> T withId(T entity, long id) {
        ReflectionTestUtils.setField(entity, "id", id);
        ReflectionTestUtils.setField(entity, "createdAt", T0);
        return entity;
    }
}
