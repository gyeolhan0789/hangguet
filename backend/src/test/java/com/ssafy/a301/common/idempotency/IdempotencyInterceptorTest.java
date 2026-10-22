package com.ssafy.a301.common.idempotency;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.GlobalExceptionHandler;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

class IdempotencyInterceptorTest {
    private static final String KEY = "6f1c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34";

    private final InMemoryStore store = new InMemoryStore();
    private final SampleController controller = new SampleController();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc =
                MockMvcBuilders.standaloneSetup(controller)
                        .setControllerAdvice(new GlobalExceptionHandler())
                        .addInterceptors(
                                new IdempotencyInterceptor(
                                        new StaticListableBeanFactory(Map.of("store", store))
                                                .getBeanProvider(IdempotencyStore.class)))
                        .addFilters(new IdempotencyFilter())
                        .build();
    }

    @Test
    void missingKeyIsValidationFailed() throws Exception {
        mvc.perform(
                        post("/things")
                                .principal(user(7))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("Idempotency-Key"))
                .andExpect(jsonPath("$.errors[0].reason").value("필수 헤더입니다."));
        assertThat(controller.calls).hasValue(0);
    }

    @Test
    void keyMustBeUuid() throws Exception {
        mvc.perform(create(7, "not-a-uuid", "{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("Idempotency-Key"))
                .andExpect(jsonPath("$.errors[0].reason").value("UUID 형식입니다."));
        assertThat(controller.calls).hasValue(0);
    }

    @Test
    void sameRequestRunsOnceAndReplaysFirstResponse() throws Exception {
        String first =
                mvc.perform(create(7, KEY, "{\"name\":\"a\"}"))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        mvc.perform(create(7, KEY, "{\"name\":\"a\"}"))
                .andExpect(status().isCreated())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(content().json(first));
        assertThat(controller.calls).hasValue(1);
    }

    @Test
    void responseWithoutBodyIsReplayed() throws Exception {
        mvc.perform(post("/things/end").principal(user(7)).header(Idempotent.HEADER, KEY))
                .andExpect(status().isAccepted());
        mvc.perform(post("/things/end").principal(user(7)).header(Idempotent.HEADER, KEY))
                .andExpect(status().isAccepted())
                .andExpect(content().string(""));
        assertThat(controller.calls).hasValue(1);
    }

    @Test
    void sameKeyWithDifferentBodyOrApiIsConflict() throws Exception {
        mvc.perform(create(7, KEY, "{\"name\":\"a\"}")).andExpect(status().isCreated());

        mvc.perform(create(7, KEY, "{\"name\":\"b\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
        mvc.perform(post("/things/end").principal(user(7)).header(Idempotent.HEADER, KEY))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
        assertThat(controller.calls).hasValue(1);
    }

    @Test
    void sameKeyWhileProcessingIsConflict() throws Exception {
        controller.duringCall =
                () -> {
                    try {
                        mvc.perform(create(7, KEY, "{\"name\":\"a\"}"))
                                .andExpect(status().isConflict())
                                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
                    } catch (Exception ex) {
                        throw new AssertionError(ex);
                    }
                };

        mvc.perform(create(7, KEY, "{\"name\":\"a\"}")).andExpect(status().isCreated());
        assertThat(controller.calls).hasValue(1);
    }

    @Test
    void failedRequestCanBeRetriedWithSameKey() throws Exception {
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/things/fail").principal(user(7)).header(Idempotent.HEADER, KEY))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        }
        assertThat(controller.calls).hasValue(2);
    }

    @Test
    void sameKeyOfAnotherUserIsIndependent() throws Exception {
        mvc.perform(create(7, KEY, "{\"name\":\"a\"}")).andExpect(status().isCreated());
        mvc.perform(create(8, KEY, "{\"name\":\"b\"}")).andExpect(status().isCreated());

        assertThat(controller.calls).hasValue(2);
    }

    @Test
    void apiWithoutAnnotationIgnoresKey() throws Exception {
        mvc.perform(post("/things/plain").principal(user(7))).andExpect(status().isOk());
        mvc.perform(post("/things/plain").principal(user(7)).header(Idempotent.HEADER, KEY))
                .andExpect(status().isOk());
        assertThat(controller.calls).hasValue(2);
        assertThat(store.records).isEmpty();
    }

    private static MockHttpServletRequestBuilder create(long userId, String key, String body) {
        return post("/things")
                .principal(user(userId))
                .header(Idempotent.HEADER, key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private static UsernamePasswordAuthenticationToken user(long id) {
        return new UsernamePasswordAuthenticationToken(Long.toString(id), null);
    }

    @RestController
    static class SampleController {
        final AtomicInteger calls = new AtomicInteger();
        Runnable duringCall = () -> {};

        @Idempotent
        @PostMapping("/things")
        @ResponseStatus(HttpStatus.CREATED)
        Map<String, Object> create(@RequestBody Map<String, Object> body) {
            int call = calls.incrementAndGet();
            duringCall.run();
            return Map.of("id", call, "name", body.get("name"));
        }

        @Idempotent
        @PostMapping("/things/end")
        ResponseEntity<Void> end() {
            calls.incrementAndGet();
            return ResponseEntity.accepted().build();
        }

        @Idempotent
        @PostMapping("/things/fail")
        void fail() {
            calls.incrementAndGet();
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }

        @PostMapping("/things/plain")
        void plain() {
            calls.incrementAndGet();
        }
    }

    /** RedisIdempotencyStore와 같은 규칙의 메모리 저장소. */
    static class InMemoryStore implements IdempotencyStore {
        final Map<String, IdempotencyRecord> records = new HashMap<>();

        @Override
        public IdempotencyRecord begin(long userId, UUID key, String fingerprint) {
            return records.putIfAbsent(
                    userId + ":" + key, IdempotencyRecord.processing(fingerprint));
        }

        @Override
        public void complete(long userId, UUID key, IdempotencyRecord record) {
            records.put(userId + ":" + key, record);
        }

        @Override
        public void release(long userId, UUID key, String fingerprint) {
            records.remove(userId + ":" + key, IdempotencyRecord.processing(fingerprint));
        }
    }
}
