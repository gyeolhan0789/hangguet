// 1. 인증 응답. 기준: mock AuthDtos · UserDtos.UserSummary · AuthController.

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
  /** 프로필 사진 임시 주소(만료됨). 등록하지 않았으면 null */
  profileImageUrl: string | null;
}

/** 1.2 회원가입(201) · 1.3 로그인(200) */
export interface TokenResponse {
  /** API 호출용 JWT(HS256). sub(회원 id) · nickname · iat · exp를 담는다. `Authorization: Bearer {accessToken}` */
  accessToken: string;
  /** 액세스 토큰 재발급용 토큰(1.4). JWT가 아닌 불투명한 문자열 */
  refreshToken: string;
  /** 액세스 토큰 유효 시간(초) */
  expiresIn: number;
  /** 로그인한 회원 */
  user: UserSummary;
}

/** 1.4 토큰 재발급 (200) */
export interface RefreshResponse {
  /** 새 액세스 토큰. 1.3 응답의 accessToken과 같은 형식 */
  accessToken: string;
  /** 새 리프레시 토큰. 요청에 쓴 토큰은 다시 쓸 수 없다 */
  refreshToken: string;
  /** 액세스 토큰 유효 시간(초) */
  expiresIn: number;
}

// 1.5 로그아웃은 204(본문 없음)
