package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import java.security.SecureRandom;
import java.util.Locale;
import org.springframework.stereotype.Component;

/** 초대 코드 6자리(docs/그룹면접-설계.md 6.1). 헷갈리는 글자(0 · O · 1 · I · L)를 뺀 대문자 · 숫자로 만든다. */
@Component
public class InviteCodes {
    static final String ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    static final int LENGTH = 6;
    // 대기 중인 그룹과 겹치면 다시 뽑는다. 31^6(약 8억)개라 거의 겹치지 않는다
    private static final int MAX_ATTEMPTS = 5;
    private final SecureRandom random = new SecureRandom();
    private final InterviewGroupRepository groups;

    public InviteCodes(InterviewGroupRepository groups) {
        this.groups = groups;
    }

    /** 대기 중인 그룹과 겹치지 않는 새 코드 */
    public String next() {
        for (int attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            String code = random();
            if (!groups.existsByInviteCodeAndStatus(code, GroupStatus.WAITING)) {
                return code;
            }
        }
        throw new IllegalStateException("겹치지 않는 초대 코드를 만들지 못했다");
    }

    /** 화면이 소문자로 보내도 같은 코드로 본다 */
    public static String normalize(String code) {
        return code.strip().toUpperCase(Locale.ROOT);
    }

    private String random() {
        StringBuilder code = new StringBuilder(LENGTH);
        for (int i = 0; i < LENGTH; i++) {
            code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }
}
