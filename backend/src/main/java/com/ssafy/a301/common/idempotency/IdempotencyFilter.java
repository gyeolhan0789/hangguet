package com.ssafy.a301.common.idempotency;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Idempotency-Key 헤더가 있는 요청만 본문을 미리 읽고 응답을 모아 둔다. IdempotencyInterceptor가 요청 지문을 구하고 성공 응답을 저장할 수
 * 있게 한다.
 */
@Component
public class IdempotencyFilter extends OncePerRequestFilter {

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getHeader(Idempotent.HEADER) == null;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        ContentCachingResponseWrapper cachingResponse = new ContentCachingResponseWrapper(response);
        try {
            chain.doFilter(new CachedBodyRequest(request), cachingResponse);
        } finally {
            cachingResponse.copyBodyToResponse();
        }
    }
}
