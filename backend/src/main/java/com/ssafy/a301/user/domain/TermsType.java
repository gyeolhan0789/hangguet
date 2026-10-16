package com.ssafy.a301.user.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "약관 종류. TERMS 이용약관 · PRIVACY 개인정보 수집·이용 · RECORDING 녹화 영상 저장")
public enum TermsType {
    TERMS,
    PRIVACY,
    RECORDING
}
