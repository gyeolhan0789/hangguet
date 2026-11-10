package com.ssafy.a301.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 같은 회원의 변경과 탈퇴가 겹칠 때 서로의 변경을 덮어쓰지 않는지 실제 PostgreSQL 행 잠금으로 확인한다. 한쪽 트랜잭션이 잠금을 쥔 채 멈춘 사이에 다른 요청을
 * 보내고, 잠금이 풀린 뒤 결과를 본다.
 */
@SpringBootTest
class UserConcurrencyTest {
    @Autowired private UserService service;
    @Autowired private UserRepository users;
    @Autowired private PasswordEncoder passwords;
    @Autowired private TransactionTemplate transactions;
    @Autowired private JdbcTemplate jdbc;
    private String email;
    private long userId;

    @BeforeEach
    void setUp() {
        email = "concurrency-" + UUID.randomUUID() + "@example.com";
        userId = users.saveAndFlush(new User(email, passwords.encode("abcd1234"), "이전닉네임")).getId();
    }

    @AfterEach
    void cleanup() {
        jdbc.update("DELETE FROM users WHERE email = ?", email);
    }

    @Test
    void changeWaitingForWithdrawalDoesNotRestoreAccount() throws Exception {
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var withdrawal =
                CompletableFuture.runAsync(
                        () ->
                                transactions.executeWithoutResult(
                                        status -> {
                                            users.findActiveForUpdate(userId)
                                                    .orElseThrow()
                                                    .withdraw(OffsetDateTime.now());
                                            locked.countDown();
                                            await(release);
                                        }));
        assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();

        var change = CompletableFuture.supplyAsync(() -> service.changeNickname(userId, "새닉네임"));
        // 탈퇴 트랜잭션이 잠금을 쥐고 있는 동안 닉네임 변경은 끝나지 않는다
        assertThatThrownBy(() -> change.get(300, TimeUnit.MILLISECONDS))
                .isInstanceOf(TimeoutException.class);
        assertThat(change).isNotDone();
        release.countDown();
        withdrawal.get(5, TimeUnit.SECONDS);

        assertThatThrownBy(() -> change.get(5, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class)
                .cause()
                .isInstanceOfSatisfying(
                        ApiException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.UNAUTHORIZED));
        assertThat(column("deleted_at")).isNotNull();
        assertThat(column("nickname")).isEqualTo("이전닉네임");
    }

    @Test
    void withdrawalWaitingForChangeKeepsBothChanges() throws Exception {
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var change =
                CompletableFuture.runAsync(
                        () ->
                                transactions.executeWithoutResult(
                                        status -> {
                                            users.findActiveForUpdate(userId)
                                                    .orElseThrow()
                                                    .changeNickname("새닉네임");
                                            locked.countDown();
                                            await(release);
                                        }));
        assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();

        var withdrawal = CompletableFuture.runAsync(() -> service.withdraw(userId, "abcd1234"));
        // 닉네임 변경 트랜잭션이 잠금을 쥐고 있는 동안 탈퇴는 끝나지 않는다
        assertThatThrownBy(() -> withdrawal.get(300, TimeUnit.MILLISECONDS))
                .isInstanceOf(TimeoutException.class);
        assertThat(withdrawal).isNotDone();
        release.countDown();
        change.get(5, TimeUnit.SECONDS);
        withdrawal.get(5, TimeUnit.SECONDS);

        assertThat(column("nickname")).isEqualTo("새닉네임");
        assertThat(column("deleted_at")).isNotNull();
    }

    private Object column(String name) {
        return jdbc.queryForObject(
                "SELECT " + name + " FROM users WHERE id = ?", Object.class, userId);
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }
}
