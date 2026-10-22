package com.ssafy.a301.common.idempotency;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
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
 *   <li>이미 끝난 같은 요청이면 저장한 응답을 그대로 돌려준다. 다른 요청이거나 아직 처리 중이면 409
 *   <li>2xx로 끝나면 응답을 저장하고, 실패하면 처리 중 표시를 지워 다시 시도할 수 있게 한다
 * </ol>
 */
public class IdempotencyInterceptor implements HandlerInterceptor {
    private static final String ATTRIBUTE = IdempotencyInterceptor.class.getName() + ".pending";

    // 저장소는 멱등 API를 처음 처리할 때 찾는다. 멱등 API가 없는 컨트롤러 테스트는 Redis 없이 뜬다
    private final ObjectProvider<IdempotencyStore> store;

    public IdempotencyInterceptor(ObjectProvider<IdempotencyStore> store) {
        this.store = store;
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
        IdempotencyRecord existing = store.getObject().begin(userId, key, fingerprint);
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
        if (!(request.getAttribute(ATTRIBUTE) instanceof Pending pending)) {
            return;
        }
        ContentCachingResponseWrapper body =
                WebUtils.getNativeResponse(response, ContentCachingResponseWrapper.class);
        int status = response.getStatus();
        if (ex != null || body == null || status < 200 || status >= 300) {
            store.getObject().release(pending.userId(), pending.key(), pending.fingerprint());
            return;
        }
        store.getObject()
                .complete(
                        pending.userId(),
                        pending.key(),
                        IdempotencyRecord.completed(
                                pending.fingerprint(),
                                status,
                                response.getContentType(),
                                new String(body.getContentAsByteArray(), StandardCharsets.UTF_8)));
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
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(
                    (request.getMethod() + " " + request.getRequestURI() + "\n")
                            .getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest.digest(body));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    private static void replay(HttpServletResponse response, IdempotencyRecord record)
            throws IOException {
        response.setStatus(record.status());
        if (record.contentType() != null) {
            response.setContentType(record.contentType());
        }
        response.getOutputStream().write(record.body().getBytes(StandardCharsets.UTF_8));
    }

    private record Pending(long userId, UUID key, String fingerprint) {}
}
