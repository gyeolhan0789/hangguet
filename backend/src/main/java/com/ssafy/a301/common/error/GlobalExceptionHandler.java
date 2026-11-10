package com.ssafy.a301.common.error;

import java.util.List;
import java.util.Map;
import org.springframework.beans.TypeMismatchException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import tools.jackson.core.JacksonException;

/**
 * 모든 오류를 RFC 9457 ProblemDetail + code로 응답한다. 400 VALIDATION_FAILED는 errors[{ field, reason }]를
 * 더한다. Spring 자체 오류(잘못된 JSON, 없는 경로 등)에도 code를 붙인다.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {
    private static final String INVALID_VALUE = "형식이 맞지 않습니다.";

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ProblemDetail> handleApi(ApiException ex) {
        ProblemDetail pd = problem(ex.errorCode());
        var response = ResponseEntity.status(ex.errorCode().status());
        if (ex.retryAfter() != null) {
            // 초 단위로 올려 남은 시간보다 일찍 다시 시도하지 않게 한다
            long seconds = Math.max(1, (ex.retryAfter().toMillis() + 999) / 1000);
            pd.setProperty("retryAfterSeconds", seconds);
            response.header(HttpHeaders.RETRY_AFTER, Long.toString(seconds));
        }
        return response.body(pd);
    }

    @ExceptionHandler(FieldValidationException.class)
    public ResponseEntity<Object> handleFieldValidation(FieldValidationException ex) {
        return validationFailed(List.of(error(ex.field(), ex.reason())));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleUnknown(Exception ex) {
        logger.error("처리하지 못한 예외", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(problem(ErrorCode.INTERNAL_ERROR));
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        List<Map<String, String>> errors =
                ex.getBindingResult().getFieldErrors().stream()
                        .map(e -> error(e.getField(), String.valueOf(e.getDefaultMessage())))
                        .toList();
        return validationFailed(errors);
    }

    @Override
    protected ResponseEntity<Object> handleHandlerMethodValidationException(
            HandlerMethodValidationException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        List<Map<String, String>> errors =
                ex.getParameterValidationResults().stream()
                        .flatMap(
                                r ->
                                        r.getResolvableErrors().stream()
                                                .map(
                                                        e ->
                                                                error(
                                                                        String.valueOf(
                                                                                r.getMethodParameter()
                                                                                        .getParameterName()),
                                                                        String.valueOf(
                                                                                e
                                                                                        .getDefaultMessage()))))
                        .toList();
        return validationFailed(errors);
    }

    /** 본문이 JSON이 아니거나 값의 형식·enum이 맞지 않으면 그 필드를 errors에 담는다. 위치를 모르면 field는 body */
    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(
            HttpMessageNotReadableException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        for (Throwable cause = ex.getCause(); cause != null; cause = cause.getCause()) {
            if (cause instanceof JacksonException jackson && !jackson.getPath().isEmpty()) {
                return validationFailed(List.of(error(fieldPath(jackson), INVALID_VALUE)));
            }
        }
        return validationFailed(List.of(error("body", "요청 본문을 읽을 수 없습니다.")));
    }

    /** 경로·쿼리 값의 형식이 맞지 않으면(숫자 id에 문자 등) 그 이름을 errors에 담는다 */
    @Override
    protected ResponseEntity<Object> handleTypeMismatch(
            TypeMismatchException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        String field =
                ex instanceof MethodArgumentTypeMismatchException mismatch
                        ? mismatch.getName()
                        : String.valueOf(ex.getPropertyName());
        return validationFailed(List.of(error(field, INVALID_VALUE)));
    }

    @Override
    protected ResponseEntity<Object> handleServletRequestBindingException(
            ServletRequestBindingException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        if (ex instanceof MissingRequestHeaderException missing) {
            return validationFailed(List.of(error(missing.getHeaderName(), "필수 헤더입니다.")));
        }
        return super.handleServletRequestBindingException(ex, headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleMissingServletRequestParameter(
            MissingServletRequestParameterException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        return validationFailed(List.of(error(ex.getParameterName(), "필수 값입니다.")));
    }

    @Override
    protected ResponseEntity<Object> createResponseEntity(
            Object body, HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        if (body instanceof ProblemDetail pd && !hasCode(pd)) {
            String code = defaultCode(statusCode);
            pd.setProperty("code", code);
            // Spring 기본 문구는 영어 내부 메시지(경로 등)라 사용자용 문구로 바꾼다
            pd.setDetail(defaultDetail(code));
        }
        return super.createResponseEntity(body, headers, statusCode, request);
    }

    private static boolean hasCode(ProblemDetail pd) {
        Map<String, Object> properties = pd.getProperties();
        return properties != null && properties.containsKey("code");
    }

    private ResponseEntity<Object> validationFailed(List<Map<String, String>> errors) {
        ProblemDetail pd = problem(ErrorCode.VALIDATION_FAILED);
        pd.setProperty("errors", errors.stream().distinct().toList());
        return ResponseEntity.badRequest().body(pd);
    }

    // 객체 속 필드는 a.b, 배열 원소는 a[0]으로 적는다
    private static String fieldPath(JacksonException ex) {
        StringBuilder path = new StringBuilder();
        for (JacksonException.Reference ref : ex.getPath()) {
            if (ref.getPropertyName() != null) {
                if (!path.isEmpty()) {
                    path.append(".");
                }
                path.append(ref.getPropertyName());
            } else if (ref.getIndex() >= 0) {
                path.append("[").append(ref.getIndex()).append("]");
            }
        }
        return path.isEmpty() ? "body" : path.toString();
    }

    private static Map<String, String> error(String field, String reason) {
        return Map.of("field", field, "reason", reason);
    }

    private static ProblemDetail problem(ErrorCode code) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(code.status(), code.message());
        pd.setProperty("code", code.name());
        return pd;
    }

    private static String defaultDetail(String code) {
        return switch (code) {
            case "VALIDATION_FAILED", "UNAUTHORIZED", "INTERNAL_ERROR" ->
                    ErrorCode.valueOf(code).message();
            case "NOT_FOUND" -> "요청한 주소를 찾을 수 없어요.";
            case "METHOD_NOT_ALLOWED" -> "지원하지 않는 요청 방식이에요.";
            case "UNSUPPORTED_MEDIA_TYPE" -> "지원하지 않는 요청 형식이에요.";
            default -> "요청을 처리할 수 없어요.";
        };
    }

    private static String defaultCode(HttpStatusCode status) {
        if (status.value() == HttpStatus.BAD_REQUEST.value()) {
            return ErrorCode.VALIDATION_FAILED.name();
        }
        if (status.value() == HttpStatus.UNAUTHORIZED.value()) {
            return ErrorCode.UNAUTHORIZED.name();
        }
        if (status.is5xxServerError()) {
            return ErrorCode.INTERNAL_ERROR.name();
        }
        HttpStatus resolved = HttpStatus.resolve(status.value());
        return resolved != null ? resolved.name() : "HTTP_" + status.value();
    }
}
