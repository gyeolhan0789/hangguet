package com.ssafy.a301.auth.reset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.time.Duration;
import java.util.Properties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;

class PasswordResetMailerTest {
    private final JavaMailSender mailSender = mock(JavaMailSender.class);

    @BeforeEach
    void setUp() {
        when(mailSender.createMimeMessage())
                .thenAnswer(invocation -> new MimeMessage(Session.getInstance(new Properties())));
    }

    @Test
    void sendsLinkWithTokenFromConfiguredAccountInUtf8() throws Exception {
        // 따로 보내는 대신 바로 실행해 확인한다
        var mailer =
                new PasswordResetMailer(mailSender, properties("noreply@test.com"), Runnable::run);

        mailer.send("a@test.com", "token-1");

        ArgumentCaptor<MimeMessage> sent = ArgumentCaptor.forClass(MimeMessage.class);
        verify(mailSender).send(sent.capture());
        MimeMessage message = sent.getValue();
        InternetAddress from = (InternetAddress) message.getFrom()[0];
        assertThat(from.getAddress()).isEqualTo("noreply@test.com");
        assertThat(from.getPersonal()).isEqualTo("한끗");
        // 한글 이름은 헤더에 그대로 넣지 않고 인코딩한다
        assertThat(message.getHeader("From")[0]).startsWith("=?UTF-8?");
        assertThat(message.getAllRecipients())
                .extracting(Object::toString)
                .containsExactly("a@test.com");
        assertThat(message.getSubject()).isEqualTo("[한끗] 비밀번호 재설정 안내");
        assertThat((String) message.getContent())
                .contains("https://hangguet.co.kr/password-reset?token=token-1")
                .contains("30분");
    }

    @Test
    void withoutMailAccountNothingIsSent() {
        var mailer = new PasswordResetMailer(mailSender, properties(""), Runnable::run);

        mailer.send("a@test.com", "token-1");

        verify(mailSender, never()).send(any(MimeMessage.class));
    }

    @Test
    void sendFailureIsOnlyLogged() {
        doThrow(new MailSendException("down")).when(mailSender).send(any(MimeMessage.class));
        var mailer =
                new PasswordResetMailer(mailSender, properties("noreply@test.com"), Runnable::run);

        mailer.send("a@test.com", "token-1");

        verify(mailSender).send(any(MimeMessage.class));
    }

    private static PasswordResetProperties properties(String mailFrom) {
        return new PasswordResetProperties(
                Duration.ofMinutes(30),
                Duration.ofMinutes(1),
                "https://hangguet.co.kr/password-reset",
                mailFrom);
    }
}
