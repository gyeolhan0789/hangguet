// 3. 홈 · 스트릭 요청. 기준: 웹 Swagger 3.1 ~ 3.3.
// 3.1 홈 · 3.2 통계는 요청 값이 없다.

/** 3.3 GET /practice-logs 쿼리 */
export interface PracticeLogsQuery {
  /** 조회할 달. 필수, `YYYY-MM` */
  month: string;
}
