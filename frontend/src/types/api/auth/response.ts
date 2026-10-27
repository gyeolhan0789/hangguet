// 1. 인증 응답. 기준: 웹 Swagger 1.1 ~ 1.4.

/** 1.1 이메일 사용 가능 여부 (200) */
export interface EmailAvailabilityResponse {
  /** 가입에 쓸 수 있으면 true. 사용 중이면 false(오류 아님) */
  available: boolean;
}

/** 토큰 응답에 담기는 회원 */
export interface UserSummary {
  id: number;
  /** 로그인 아이디 */
  email: string;
  nickname: string;
  /** 프로필 사진 주소. 없으면 null(웹 Swagger 1.2 · 1.3 예시) */
  profileImageUrl: string | null;
}

/** 1.2 회원가입(201) · 1.3 로그인(200) */
export interface TokenResponse {
  /** API 호출용 JWT(웹 Swagger bearerFormat JWT, 2.2 "토큰의 nickname"). `Authorization: Bearer {accessToken}` */
  accessToken: string;
  /** 액세스 토큰 재발급용 토큰(1.4) */
  refreshToken: string;
  /** 액세스 토큰 유효 시간(초) */
  expiresIn: number;
  /** 로그인한 회원 */
  user: UserSummary;
}

/** 1.4 토큰 재발급 (200) */
export interface RefreshResponse {
  /** 새 액세스 토큰 */
  accessToken: string;
  /** 새 리프레시 토큰. 보낸 리프레시 토큰은 다시 쓸 수 없다(웹 Swagger 1.4) */
  refreshToken: string;
  /** 액세스 토큰 유효 시간(초) */
  expiresIn: number;
}

// 1.5 로그아웃은 204(본문 없음)
