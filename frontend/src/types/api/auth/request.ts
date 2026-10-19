// 1. 인증 요청. 기준: mock AuthDtos · AuthController(develop, S15P31A301-104 반영).

/** 약관 종류. TERMS 이용약관 · PRIVACY 개인정보 수집·이용 · RECORDING 면접 녹화·음성 이용 */
export type TermsType = "TERMS" | "PRIVACY" | "RECORDING";

/** 1.1 GET /auth/email-availability 쿼리 */
export interface EmailAvailabilityQuery {
  /** 확인할 이메일. 이메일 형식, 최대 255자 */
  email: string;
}

/** 동의한 약관 하나 */
export interface AgreementRequest {
  termsType: TermsType;
  /** 화면에 보여 준 약관 버전. 필수, 최대 20자 */
  termsVersion: string;
}

/** 1.2 POST /auth/signup 본문 */
export interface SignupRequest {
  /** 로그인 아이디. 필수, 이메일 형식, 최대 255자. 가입 후 변경 불가 */
  email: string;
  /** 필수, 8~64자, 영문 · 숫자 각 1자 이상 */
  password: string;
  /** 화면에 보이는 이름. 필수, 최대 50자, 앞뒤 공백 제거 */
  nickname: string;
  /**
   * 필수 약관 3개(TERMS · PRIVACY · RECORDING) 모두 동의. 필수, 정확히 3개, termsType 중복 불가.
   * 3개가 아니면 400 VALIDATION_FAILED, 3개 중 빠진 종류가 있으면 400 AGREEMENT_REQUIRED
   */
  agreements: AgreementRequest[];
}

/** 1.3 POST /auth/login 본문 */
export interface LoginRequest {
  /** 필수, 최대 255자 */
  email: string;
  /** 필수, 최대 64자 */
  password: string;
}

/** 1.4 POST /auth/token/refresh 본문 */
export interface RefreshRequest {
  /** 마지막으로 받은 리프레시 토큰. 필수 */
  refreshToken: string;
}

/** 1.5 POST /auth/logout 본문 */
export interface LogoutRequest {
  /** 폐기할 리프레시 토큰. 필수 */
  refreshToken: string;
}
