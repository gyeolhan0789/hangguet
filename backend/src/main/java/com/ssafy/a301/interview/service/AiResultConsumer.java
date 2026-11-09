package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.repository.AiResultQueue;
import java.sql.SQLRecoverableException;
import java.sql.SQLTransientException;
import java.time.Duration;
import java.util.function.Consumer;
import org.hibernate.exception.JDBCConnectionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.SmartLifecycle;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.RecoverableDataAccessException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.CannotCreateTransactionException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI 결과 큐(ai:results)를 하나씩 꺼내 저장한다(BE 설계 5.5). 기동하면 처리 중 목록에 남은 메시지(지난번에 처리 도중 멈춘 것)부터 처리한다.
 *
 * <ul>
 *   <li>저장했거나 버린 메시지는 처리 중 목록에서 지운다
 *   <li>DB·Redis 연결 장애처럼 잠시 뒤 될 수 있는 실패({@link #isTemporary})만 지우지 않고 같은 메시지를 다시 처리한다(순서 유지)
 *   <li>그 밖의 실패(형식 오류, DB 제약 위반, 예상하지 못한 오류)는 다시 해도 같으므로 실패 목록으로 옮긴다. 한 메시지가 뒤의 모든 결과(모든 면접)를 막지 않게
 *       하기 위해서다
 * </ul>
 */
@Component
public class AiResultConsumer implements SmartLifecycle {
    private static final Logger LOG = LoggerFactory.getLogger(AiResultConsumer.class);
    private static final Duration POLL_TIMEOUT = Duration.ofSeconds(2);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final AiResultQueue queue;
    private final Consumer<String> handler;
    private final boolean enabled;
    private final Duration retryDelay;
    private final String threadName;
    private volatile boolean running;
    private Thread worker;

    @Autowired
    public AiResultConsumer(
            AiResultQueue queue,
            AiResultService results,
            @Value("${ai-result.consumer-enabled:true}") boolean enabled,
            @Value("${ai-result.retry-delay:5s}") Duration retryDelay) {
        this(queue, results::handle, enabled, retryDelay, "ai-result-consumer");
    }

    /**
     * 같은 방식으로 다른 결과 큐를 처리한다(그룹 면접 결과 큐). handler는 다시 처리해도 안 되는 메시지에 InvalidAiResultException 등을 던진다
     */
    protected AiResultConsumer(
            AiResultQueue queue,
            Consumer<String> handler,
            boolean enabled,
            Duration retryDelay,
            String threadName) {
        this.queue = queue;
        this.handler = handler;
        this.enabled = enabled;
        this.retryDelay = retryDelay;
        this.threadName = threadName;
    }

    @Override
    public void start() {
        if (!enabled) {
            return;
        }
        running = true;
        worker = new Thread(this::run, threadName);
        worker.setDaemon(true);
        worker.start();
    }

    @Override
    public void stop() {
        running = false;
        if (worker != null) {
            worker.interrupt();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    private void run() {
        while (running) {
            try {
                queue.processing().forEach(this::process);
                break;
            } catch (RuntimeException ex) {
                LOG.warn("처리 중 목록을 읽지 못해 다시 시도한다", ex);
                pause();
            }
        }
        while (running) {
            try {
                queue.take(POLL_TIMEOUT).ifPresent(this::process);
            } catch (RuntimeException ex) {
                LOG.warn("결과 큐를 읽지 못해 다시 시도한다", ex);
                pause();
            }
        }
    }

    /** 메시지 하나를 끝낼 때까지 처리한다. 멈추는 중이면 처리 중 목록에 남겨 다음 기동 때 처리한다 */
    void process(String message) {
        while (true) {
            try {
                finish(message);
                return;
            } catch (RuntimeException ex) {
                // 잠시 뒤 될 수 있는 실패만 여기로 온다(저장, 또는 큐에서 지우기·옮기기)
                LOG.warn("결과 메시지를 저장하지 못해 다시 시도한다: {}", describe(message), ex);
                if (!running) {
                    return;
                }
                pause();
            }
        }
    }

    // 저장했거나 버렸으면 지우고, 다시 해도 안 되면 실패 목록으로 옮긴다. 잠시 뒤 될 수 있는 실패는 그대로 던진다
    private void finish(String message) {
        try {
            handler.accept(message);
            queue.done(message);
        } catch (RuntimeException ex) {
            if (isTemporary(ex)) {
                throw ex;
            }
            LOG.warn("저장할 수 없는 결과 메시지를 실패 목록으로 옮긴다: {}", describe(message), ex);
            queue.fail(message);
        }
    }

    /** 로그용 식별 정보. 메시지에는 답변·평가 글이 들어 있으므로 원문은 남기지 않는다 */
    static String describe(String message) {
        try {
            JsonNode node = JSON.readTree(message);
            return "type="
                    + node.path("type").asString(null)
                    + " sessionId="
                    + node.path("sessionId").asString(null)
                    + " jobId="
                    + node.path("jobId").asString(null);
        } catch (JacksonException | IllegalArgumentException ex) {
            return "형식 오류(길이 " + (message == null ? 0 : message.length()) + ")";
        }
    }

    /** DB·Redis 연결 장애, 시간 초과, 잠금 대기처럼 같은 메시지를 잠시 뒤 다시 처리하면 될 수 있는 실패인지. 원인을 따라가며 확인한다 */
    static boolean isTemporary(Throwable ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof TransientDataAccessException
                    || cause instanceof RecoverableDataAccessException
                    || cause instanceof DataAccessResourceFailureException
                    || cause instanceof CannotCreateTransactionException
                    || cause instanceof JDBCConnectionException
                    || cause instanceof SQLTransientException
                    || cause instanceof SQLRecoverableException) {
                return true;
            }
        }
        return false;
    }

    private void pause() {
        try {
            Thread.sleep(retryDelay);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            running = false;
        }
    }
}
