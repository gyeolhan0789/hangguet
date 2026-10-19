// 2. 회원 응답. 기준: mock UserDtos · UserController.
import type { OffsetDateTime } from "../common";

/** 2.1 내 정보 · 2.2 닉네임 변경 · 2.5 프로필 사진 등록 (200) */
export interface MeResponse {
  id: number;
  /** 로그인 아이디 */
  email: string;
  nickname: string;
  /** 프로필 사진 임시 주소(만료됨). 등록하지 않았으면 null */
  profileImageUrl: string | null;
  /** 가입 일시. S09 "2026년 9월 시작" */
  createdAt: OffsetDateTime;
  /** 현재 스트릭(오늘 또는 어제까지 빠짐없이 이어진 연습일 수). 모든 화면 헤더(C01) "스트릭 7일" */
  currentStreak: number;
}

// 2.4 프로필 사진 업로드 주소(200)는 공통 UploadUrlResponse(../common)
// 2.3 비밀번호 변경 · 2.6 프로필 사진 삭제 · 2.7 회원 탈퇴는 204(본문 없음)
