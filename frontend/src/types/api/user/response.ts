// 2. 회원 응답. 기준: 웹 Swagger 2.1 ~ 2.5.
import type { OffsetDateTime } from "../common";

/** 소셜 로그인 제공자. KAKAO 카카오 */
export type SocialProvider = "KAKAO";

/** 2.1 내 정보 · 2.5 프로필 사진 등록 (200) */
export interface MeResponse {
  id: number;
  /** 로그인 아이디 */
  email: string;
  nickname: string;
  /**
   * 소셜 회원이면 가입한 제공자, 이메일 회원이면 null.
   * 소셜 회원은 비밀번호가 없어 2.3을 쓸 수 없고 2.7에 비밀번호를 보내지 않는다
   */
  socialProvider: SocialProvider | null;
  /** 프로필 사진 주소. 없으면 null(같은 회원의 웹 Swagger 1.2 · 1.3 예시 user.profileImageUrl) */
  profileImageUrl: string | null;
  /** 가입 일시. S09 "2026년 9월 시작" */
  createdAt: OffsetDateTime;
  /** 현재 스트릭. 헤더(C01) "스트릭 7일" */
  currentStreak: number;
}

/** 2.2 닉네임 변경 (200). 토큰의 nickname이 바뀌도록 새 액세스 토큰을 함께 준다. 리프레시 토큰은 그대로 쓴다 */
export interface NicknameChangeResponse extends MeResponse {
  accessToken: string;
  /** 액세스 토큰 유효 시간(초) */
  expiresIn: number;
}

/** 2.3 비밀번호 변경 (200). 변경 전에 발급한 리프레시 토큰은 모두 무효가 되므로 새 토큰을 함께 반환한다 */
export interface PasswordChangeResponse {
  accessToken: string;
  refreshToken: string;
  /** 액세스 토큰 유효 시간(초) */
  expiresIn: number;
}

// 2.4 프로필 사진 업로드 주소(200)는 공통 UploadUrlResponse(../common)
// 2.6 프로필 사진 삭제 · 2.7 회원 탈퇴는 204(본문 없음)
