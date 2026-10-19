import { isAxiosError } from "axios";

/** 실패 응답 (RFC 9457 ProblemDetail + code). 화면 분기는 `code`로 한다. */
export interface ProblemDetail {
  title: string;
  status: number;
  /** 사용자에게 보여 줄 문구 */
  detail: string;
  /** 요청 경로 */
  instance: string;
  code: string;
  /** 400 VALIDATION_FAILED일 때만 */
  errors?: { field: string; reason: string }[];
}

/** 페이지 목록 응답 */
export interface Page<T> {
  content: T[];
  page: {
    size: number;
    /** 0부터 */
    number: number;
    totalElements: number;
    totalPages: number;
  };
}

/** 토큰 응답 (1.3 로그인, 1.4 토큰 재발급) */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  /** 액세스 토큰 유효 시간(초) */
  expiresIn: number;
}

/** 내 정보 (2.1 내 정보, 2.2 닉네임 변경·2.5 프로필 사진 등록 응답도 같음) */
export interface UserResponse {
  id: number;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
  createdAt: string;
  currentStreak: number;
}

/** 로그인(1.3)·회원가입(1.2) 응답 */
export interface AuthResponse extends TokenResponse {
  user: Pick<UserResponse, "id" | "email" | "nickname" | "profileImageUrl">;
}

function isProblemDetail(data: unknown): data is ProblemDetail {
  return typeof data === "object" && data !== null && "code" in data && "status" in data;
}

/** axios 오류에서 ProblemDetail을 꺼낸다. 네트워크 오류 등 형식이 다르면 null. */
export function getProblemDetail(error: unknown): ProblemDetail | null {
  if (!isAxiosError(error)) return null;
  const data: unknown = error.response?.data;
  return isProblemDetail(data) ? data : null;
}
