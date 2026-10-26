package com.ssafy.a301.common.error;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 보안 필터 안에서 난 예상하지 못한 오류(토큰 검증 중 DB·Redis 장애 등)를 500 INTERNAL_ERROR ProblemDetail로 응답한다. 컨트롤러 오류는
 * GlobalExceptionHandler가 처리하므로 여기까지 오지 않는다.
 */
public class FilterExceptionFilter extends OncePerRequestFilter {
    private static final Logger LOG = LoggerFactory.getLogger(FilterExceptionFilter.class);

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } catch (RuntimeException ex) {
            LOG.error("요청 처리 중 필터에서 처리하지 못한 예외: {}", request.getRequestURI(), ex);
            if (response.isCommitted()) {
                throw ex;
            }
            response.reset();
            ProblemResponses.write(request, response, ErrorCode.INTERNAL_ERROR);
        }
    }
}
