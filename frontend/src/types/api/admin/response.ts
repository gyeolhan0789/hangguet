// 8. 관리자 중 회원이 쓰는 응답. 기준: Swagger 8.8 공지 목록 · 8.13 내 스트릭 유지권 · 8.14 유지권 사용(백엔드 8. 관리자).
import type { LocalDate, OffsetDateTime } from "../common";

/** 8.8 공지 하나 */
export interface NoticeItem {
  id: number;
  title: string;
  content: string;
  /** 게시 시작 일시 */
  startsAt: OffsetDateTime;
  /** 이 회원이 확인(8.9)했으면 true(확인함), 아니면 false(확인 안 함) */
  read: boolean;
}

/** 8.8 공지 목록 (200). 게시 중인 공지, 최신순(게시 시작 일시 내림차순). 없으면 빈 배열 */
export interface NoticesResponse {
  content: NoticeItem[];
}

/** 8.13 유지권 하나 */
export interface StreakFreezeItem {
  id: number;
  /** 메울 수 있는 날짜(한국 시간) */
  fillableDate: LocalDate;
  /** 지급받은 일시 */
  grantedAt: OffsetDateTime;
  /** 만료 일시. 지급 날짜부터 2주 */
  expiresAt: OffsetDateTime;
}

/** 8.13 내 스트릭 유지권 (200) */
export interface MyStreakFreezesResponse {
  /** 지금 쓸 수 있는 유지권 개수 */
  availableCount: number;
  /** 지금 쓸 수 있는 유지권, 만료가 빠른 순. 없으면 빈 배열 */
  freezes: StreakFreezeItem[];
}

/** 8.14 유지권 사용 (200) */
export interface StreakFreezeUseResponse {
  /** 메운 날짜(한국 시간). 연습 기록(3.3)과 스트릭에 연습한 날로 들어간다 */
  practiceDate: LocalDate;
  /** 사용한 유지권 id */
  freezeId: number;
  /** 남은 유지권 개수 */
  availableCount: number;
  /** 메운 뒤의 현재 스트릭 */
  currentStreak: number;
}

// 8.9 공지 확인은 204(본문 없음)
