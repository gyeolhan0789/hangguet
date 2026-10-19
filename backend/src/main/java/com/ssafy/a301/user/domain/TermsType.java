package com.ssafy.a301.user.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "TERMS: 서비스 및 개인정보 이용약관. PRIVACY·RECORDING은 기존 동의 기록 호환용이며 신규 가입에서 받지 않는다")
public enum TermsType {
    TERMS,
    PRIVACY,
    RECORDING
}
