package com.ssafy.a301.auth.reset;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

/**
 * 재설정 링크 메일(1.8). 응답을 기다리게 하지 않도록 따로 보낸다. 메일 서버를 기다리는 시간으로 가입 여부가 드러나지 않게 하려는 것이기도 하다. 보내지 못하면 기록만
 * 남긴다(요청은 이미 204)
 */
@Component
public class PasswordResetMailer {
    private static final Logger LOG = LoggerFactory.getLogger(PasswordResetMailer.class);
    private static final String SENDER_NAME = "한끗";
    private static final String SUBJECT = "[한끗] 비밀번호 재설정 안내";

    private final JavaMailSender mailSender;
    private final PasswordResetProperties properties;
    private final Executor executor;

    @Autowired
    public PasswordResetMailer(JavaMailSender mailSender, PasswordResetProperties properties) {
        this(mailSender, properties, Executors.newVirtualThreadPerTaskExecutor());
    }

    PasswordResetMailer(
            JavaMailSender mailSender, PasswordResetProperties properties, Executor executor) {
        this.mailSender = mailSender;
        this.properties = properties;
        this.executor = executor;
    }

    public void send(String to, String token) {
        if (!properties.canSendMail()) {
            LOG.warn("메일 계정(MAIL_USERNAME)이 없어 비밀번호 재설정 메일을 보내지 않음");
            return;
        }
        String text = body(properties.linkUrl() + "?token=" + token);
        executor.execute(
                () -> {
                    try {
                        // 보내는 사람 이름 · 제목이 한글이라 MIME 인코딩(UTF-8)으로 만든다
                        MimeMessage message = mailSender.createMimeMessage();
                        var helper = new MimeMessageHelper(message, StandardCharsets.UTF_8.name());
                        helper.setFrom(properties.mailFrom(), SENDER_NAME);
                        helper.setTo(to);
                        helper.setSubject(SUBJECT);
                        helper.setText(text);
                        mailSender.send(message);
                    } catch (MailException | MessagingException | UnsupportedEncodingException ex) {
                        LOG.warn("비밀번호 재설정 메일 발송 실패: {}", ex.getMessage());
                    }
                });
    }

    private String body(String link) {
        return """
        안녕하세요, 한끗입니다.

        아래 링크에서 새 비밀번호를 정해 주세요. 링크는 %d분 동안 한 번만 쓸 수 있어요.
        %s

        비밀번호 재설정을 요청하지 않았다면 이 메일을 무시해 주세요. 비밀번호는 바뀌지 않아요.
        """
                .formatted(properties.tokenTtl().toMinutes(), link);
    }
}
