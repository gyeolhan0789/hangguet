package com.ssafy.a301.common.idempotency;

import static org.assertj.core.api.Assertions.assertThat;

import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.parameters.Parameter;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.web.method.HandlerMethod;

class IdempotencyConfigTest {
    private final IdempotencyConfig config =
            new IdempotencyConfig(
                    new StaticListableBeanFactory().getBeanProvider(IdempotencyStore.class),
                    Duration.ofSeconds(10));

    @Test
    void swaggerShowsRequiredKeyHeaderOnlyOnIdempotentApi() throws Exception {
        Operation idempotent =
                config.idempotencyKeyHeader().customize(new Operation(), handler("idempotent"));
        Operation plain =
                config.idempotencyKeyHeader().customize(new Operation(), handler("plain"));

        assertThat(idempotent.getParameters()).hasSize(1);
        Parameter header = idempotent.getParameters().getFirst();
        assertThat(header.getName()).isEqualTo("Idempotency-Key");
        assertThat(header.getIn()).isEqualTo("header");
        assertThat(header.getRequired()).isTrue();
        assertThat(header.getSchema().getFormat()).isEqualTo("uuid");
        assertThat(plain.getParameters()).isNull();
    }

    private static HandlerMethod handler(String name) throws NoSuchMethodException {
        return new HandlerMethod(new Sample(), Sample.class.getDeclaredMethod(name));
    }

    static class Sample {
        @Idempotent
        void idempotent() {}

        void plain() {}
    }
}
