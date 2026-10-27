// 8. 관리자 중 회원이 쓰는 요청. 기준: Swagger 8.9 공지 확인 · 8.14 유지권 사용(백엔드 8. 관리자).
// 8.8 공지 목록 · 8.13 내 스트릭 유지권은 요청 값이 없다. 8.9는 경로의 공지 id만 보낸다.

/** 8.14 POST /users/me/streak-freezes/use 본문 */
export interface StreakFreezeUseRequest {
  /** 쓸 유지권 id(8.13). 그 유지권의 메울 수 있는 날짜를 메운다 */
  freezeId: number;
}
