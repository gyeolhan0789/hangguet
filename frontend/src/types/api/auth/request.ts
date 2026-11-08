// 1. 인증 요청. 기준: 웹 Swagger 1.1 ~ 1.9.

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

/** 1.6 POST /auth/oauth/{provider} 본문 */
export interface SocialLoginRequest {
  /** 제공자가 redirectUri로 넘겨 준 인가 코드. 필수, 최대 2048자. 한 번만 쓸 수 있다 */
  code: string;
  /** 인가 코드를 받을 때 쓴 주소. 필수, 최대 2048자. 서버에 등록한 주소만 받는다 */
  redirectUri: string;
}

/** 1.7 POST /auth/oauth/signup 본문 */
export interface SocialSignupRequest {
  /** 1.6에서 받은 가입 토큰. 필수, 최대 100자 */
  signupToken: string;
  /** 필수 약관 3개 모두 동의(1.2와 같음) */
  agreements: AgreementRequest[];
}

/** 1.8 POST /auth/password-reset 본문 */
export interface PasswordResetRequest {
  /** 가입한 이메일. 필수, 이메일 형식, 최대 255자 */
  email: string;
}

/** 1.9 POST /auth/password-reset/confirm 본문 */
export interface PasswordResetConfirmRequest {
  /** 메일 링크의 token. 필수, 최대 100자. 30분 동안 한 번만 쓸 수 있다 */
  token: string;
  /** 새 비밀번호. 필수, 8~64자, 영문 · 숫자 각 1자 이상(2.3과 같음) */
  newPassword: string;
}
