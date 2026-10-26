package com.ssafy.a301.common.idempotency;

import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.HeaderParameter;
import java.time.Duration;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** {@link Idempotent} API에 멱등성 처리를 걸고, Swagger에 Idempotency-Key 헤더를 표시한다. */
@Configuration
public class IdempotencyConfig implements WebMvcConfigurer {
    private static final String DESCRIPTION =
            "멱등 키(UUID). 같은 키·같은 본문이면 처음 결과를 그대로 반환, 같은 키·다른 본문이면 409 IDEMPOTENCY_KEY_REUSED";

    private final ObjectProvider<IdempotencyStore> store;
    private final Duration waitTimeout;

    public IdempotencyConfig(
            ObjectProvider<IdempotencyStore> store,
            @Value("${idempotency.wait-timeout:20s}") Duration waitTimeout) {
        this.store = store;
        this.waitTimeout = waitTimeout;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new IdempotencyInterceptor(store, waitTimeout));
    }

    @Bean
    public OperationCustomizer idempotencyKeyHeader() {
        return (operation, handlerMethod) -> {
            if (handlerMethod.hasMethodAnnotation(Idempotent.class)) {
                operation.addParametersItem(
                        new HeaderParameter()
                                .name(Idempotent.HEADER)
                                .required(true)
                                .description(DESCRIPTION)
                                .schema(new StringSchema().format("uuid")));
            }
            return operation;
        };
    }
}
