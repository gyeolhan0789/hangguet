package com.ssafy.a301.common.idempotency;

import com.ssafy.a301.common.crypto.Hashes;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.util.ContentCachingResponseWrapper;
import org.springframework.web.util.WebUtils;

/**
 * {@link Idempotent} API의 멱등성을 처리한다(BE 설계 8장).
 *
 * <ol>
 *   <li>처리 전에 처리 중 표시를 잡는다
 *   <li>이미 끝난 같은 요청이면 저장한 응답을 그대로 돌려준다. 다른 요청이면 409
 *   <li>같은 요청이 아직 처리 중이면 끝날 때까지 기다린다(최대 대기 시간). 성공했으면 그 응답을 돌려주고, 실패해 처리 중 표시가 지워졌으면 이번 요청이 처리한다.
 *       기다려도 끝나지 않으면 409. 화면이 409를 받으면 새 키를 쓰므로, 바로 409를 주면 같은 면접이 두 번 만들어질 수 있다
 *   <li>2xx로 끝나면 응답을 저장하고, 실패하면 처리 중 표시를 지워 다시 시도할 수 있게 한다
 * </ol>
 */
public class IdempotencyInterceptor implements HandlerInterceptor {
    private static final String ATTRIBUTE = IdempotencyInterceptor.class.getName() + ".pending";
    private static final Duration POLL_INTERVAL = Duration.ofMillis(100);

    // 저장소는 멱등 API를 처음 처리할 때 찾는다. 멱등 API가 없는 컨트롤러 테스트는 Redis 없이 뜬다
    private final ObjectProvider<IdempotencyStore> store;
    private final Duration waitTimeout;

    public IdempotencyInterceptor(ObjectProvider<IdempotencyStore> store, Duration waitTimeout) {
        this.store = store;
        this.waitTimeout = waitTimeout;
    }

    @Override
    public boolean preHandle(
            HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        if (!(handler instanceof HandlerMethod method)
                || !method.hasMethodAnnotation(Idempotent.class)) {
            return true;
        }
        UUID key = key(request);
        long userId = Long.parseLong(request.getUserPrincipal().getName());
        String fingerprint = fingerprint(request);
        IdempotencyRecord existing = waitWhileProcessing(userId, key, fingerprint);
        if (existing == null) {
            request.setAttribute(ATTRIBUTE, new Pending(userId, key, fingerprint));
            return true;
        }
        if (!existing.fingerprint().equals(fingerprint) || !existing.isCompleted()) {
            throw new ApiException(ErrorCode.IDEMPOTENCY_KEY_REUSED);
        }
        replay(response, existing);
        return false;
    }

    @Override
    public void afterCompletion(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler,
            Exception ex) {
        if (!(request.getAttribute(ATTRIBUTE)
                instanceof Pending(long userId, UUID key, String fingerprint))) {
            return;
        }
        ContentCachingResponseWrapper body =
                WebUtils.getNativeResponse(response, ContentCachingResponseWrapper.class);
        int status = response.getStatus();
        if (ex != null || body == null || status < 200 || status >= 300) {
            store.getObject().release(userId, key, fingerprint);
            return;
        }
        store.getObject()
                .complete(
                        userId,
                        key,
                        IdempotencyRecord.completed(
                                fingerprint,
                                status,
                                response.getContentType(),
                                new String(body.getContentAsByteArray(), StandardCharsets.UTF_8)));
    }

    // 처리 중 표시를 잡을 때까지(null), 또는 끝난 기록이나 다른 요청의 기록을 볼 때까지 다시 시도한다
    private IdempotencyRecord waitWhileProcessing(long userId, UUID key, String fingerprint) {
        long deadline = System.nanoTime() + waitTimeout.toNanos();
        IdempotencyRecord existing = store.getObject().begin(userId, key, fingerprint);
        while (existing != null
                && existing.fingerprint().equals(fingerprint)
                && !existing.isCompleted()
                && System.nanoTime() < deadline) {
            try {
                Thread.sleep(POLL_INTERVAL);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                break;
            }
            existing = store.getObject().begin(userId, key, fingerprint);
        }
        return existing;
    }

    private static UUID key(HttpServletRequest request) {
        String header = request.getHeader(Idempotent.HEADER);
        if (header == null || header.isBlank()) {
            throw new FieldValidationException(Idempotent.HEADER, "필수 헤더입니다.");
        }
        try {
            return UUID.fromString(header.strip());
        } catch (IllegalArgumentException ex) {
            throw new FieldValidationException(Idempotent.HEADER, "UUID 형식입니다.");
        }
    }

    // 같은 키를 다른 API에 써도 다른 요청으로 본다
    private static String fingerprint(HttpServletRequest request) {
        CachedBodyRequest cached = WebUtils.getNativeRequest(request, CachedBodyRequest.class);
        byte[] body = cached == null ? new byte[0] : cached.body();
        return Hashes.sha256Hex(
                (request.getMethod() + " " + request.getRequestURI() + "\n")
                        .getBytes(StandardCharsets.UTF_8),
                body);
    }

    private static void replay(HttpServletResponse response, IdempotencyRecord stored)
            throws IOException {
        response.setStatus(stored.status());
        if (stored.contentType() != null) {
            response.setContentType(stored.contentType());
        }
        response.getOutputStream().write(stored.body().getBytes(StandardCharsets.UTF_8));
    }

    private record Pending(long userId, UUID key, String fingerprint) {}
}
