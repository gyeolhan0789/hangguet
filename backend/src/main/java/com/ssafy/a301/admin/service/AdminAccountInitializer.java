package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.config.AdminPasswordEncoder;
import com.ssafy.a301.admin.config.AdminProperties;
import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.repository.AdminRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

/**
 * 관리자 가입 API가 없으므로 기동할 때 환경 변수(ADMIN_LOGIN_ID · ADMIN_PASSWORD · ADMIN_NAME)로 관리자를 만든다. 값이 하나라도
 * 비었거나 같은 아이디가 이미 있으면 아무것도 하지 않는다(비밀번호도 바꾸지 않음).
 */
@Component
public class AdminAccountInitializer implements ApplicationRunner {
    private static final Logger LOG = LoggerFactory.getLogger(AdminAccountInitializer.class);

    private final AdminProperties properties;
    private final AdminRepository admins;
    private final AdminPasswordEncoder passwords;

    public AdminAccountInitializer(
            AdminProperties properties, AdminRepository admins, AdminPasswordEncoder passwords) {
        this.properties = properties;
        this.admins = admins;
        this.passwords = passwords;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!properties.isComplete()
                || admins.existsByLoginIdAndDeletedAtIsNull(properties.loginId())) {
            return;
        }
        try {
            admins.save(
                    new Admin(
                            properties.loginId(),
                            passwords.encode(properties.password()),
                            properties.name()));
            LOG.info("관리자 계정을 만들었다: {}", properties.loginId());
        } catch (DataIntegrityViolationException ex) {
            // 여러 서버가 동시에 기동해 다른 쪽이 먼저 만들었다
            LOG.info("관리자 계정이 이미 있다: {}", properties.loginId());
        }
    }
}
