// API 주소 모음. 기준은 웹 mock 서버 Swagger(https://hangguet.yobistory.com/mock/be/v3/api-docs).
// 모든 주소는 baseURL(`/api/v1`) 뒤에 붙는다. 주석의 번호는 Swagger 각 API 이름 앞의 번호다.

type Id = number | string;

/** 1. 인증 */
export const authEndpoints = {
  /** 1.1 GET 이메일 사용 가능 여부 (토큰 없이) */
  emailAvailability: "/auth/email-availability",
  /** 1.2 POST 회원가입 (토큰 없이) */
  signup: "/auth/signup",
  /** 1.3 POST 로그인 (토큰 없이) */
  login: "/auth/login",
  /** 1.4 POST 토큰 재발급 (토큰 없이) */
  tokenRefresh: "/auth/token/refresh",
  /** 1.5 POST 로그아웃 */
  logout: "/auth/logout",
  /** 1.6 POST 소셜 로그인 (토큰 없이). provider는 kakao · google */
  socialLogin: (provider: "kakao" | "google") => `/auth/oauth/${provider}`,
  /** 1.7 POST 소셜 회원가입 (토큰 없이) */
  socialSignup: "/auth/oauth/signup",
} as const;

/** 2. 회원 */
export const userEndpoints = {
  /** 2.1 GET 내 정보 · 2.2 PATCH 닉네임 변경 · 2.7 POST 회원 탈퇴 */
  me: "/users/me",
  /** 2.3 PATCH 비밀번호 변경 */
  password: "/users/me/password",
  /** 2.4 POST 프로필 사진 업로드 주소 */
  profileImageUploadUrl: "/users/me/profile-image/upload-url",
  /** 2.5 PUT 프로필 사진 등록 · 2.6 DELETE 프로필 사진 삭제 */
  profileImage: "/users/me/profile-image",
  /** 2.8 GET 연습 알림 설정 · 2.9 PUT 켜기 · 2.10 PATCH 시각 변경 · 2.11 DELETE 끄기 */
  practiceAlarm: "/users/me/practice-alarm",
  /** 2.12 PUT 소셜 계정 연결 · 2.13 DELETE 연결 해제. provider는 kakao만 */
  socialAccount: (provider: "kakao") => `/users/me/social-accounts/${provider}`,
} as const;

/** 3. 홈 · 스트릭 */
export const homeEndpoints = {
  /** 3.1 GET 홈 */
  home: "/home",
  /** 3.2 GET 통계 */
  stats: "/users/me/stats",
  /** 3.3 GET 연습 달력 */
  practiceLogs: "/practice-logs",
} as const;

/** 4. 지원서 */
export const applicationEndpoints = {
  /** 4.1 POST 지원서 작성 · 4.3 GET 지원서 목록 */
  root: "/applications",
  /** 4.2 GET 조회 · 4.5 DELETE 삭제 */
  detail: (applicationId: Id) => `/applications/${applicationId}`,
  /** 4.6 GET 지원서의 연습 면접 목록(page · size) */
  sessions: (applicationId: Id) => `/applications/${applicationId}/interview-sessions`,
} as const;

/** 5. 면접 진행 */
export const interviewEndpoints = {
  /** 5.1 POST 면접 만들기 (Idempotency-Key 필수) · 5.13 GET 연습 면접 목록(practiceDate · page · size) */
  root: "/interview-sessions",
  /** 5.15 GET 월별 연습 면접 횟수(month) */
  calendar: "/interview-sessions/calendar",
  /** 5.2 GET 면접 조회 */
  detail: (sessionId: Id) => `/interview-sessions/${sessionId}`,
  /** 5.3 POST 면접 플랜 재생성 */
  planRetry: (sessionId: Id) => `/interview-sessions/${sessionId}/plan/retry`,
  /** 5.4 POST 면접 시작 (Idempotency-Key 필수) */
  start: (sessionId: Id) => `/interview-sessions/${sessionId}/start`,
  /** 5.14 POST 면접방 입장 토큰 */
  roomToken: (sessionId: Id) => `/interview-sessions/${sessionId}/room-token`,
  /** 5.5 GET 지금 질문 */
  currentQuestion: (sessionId: Id) => `/interview-sessions/${sessionId}/questions/current`,
  /** 5.7 POST 답변 제출 (Idempotency-Key 필수) */
  answer: (sessionId: Id, questionId: Id) =>
    `/interview-sessions/${sessionId}/questions/${questionId}/answer`,
  /** 5.8 POST 면접 끝내기 (Idempotency-Key 필수) */
  end: (sessionId: Id) => `/interview-sessions/${sessionId}/end`,
  /** 5.9 POST 결과 재생성 */
  analysisRetry: (sessionId: Id) => `/interview-sessions/${sessionId}/analysis/retry`,
} as const;

/** 6. 녹화 · 결과 · 다시보기 */
export const resultEndpoints = {
  /** 6.3 GET 면접 결과 */
  result: (sessionId: Id) => `/interview-sessions/${sessionId}/result`,
  /** 6.4 GET 다시보기 */
  replay: (sessionId: Id) => `/interview-sessions/${sessionId}/replay`,
} as const;

/** 7. 성장 리뷰 */
export const growthReviewEndpoints = {
  /** 7.2 GET 최근 성장 리뷰 */
  recent: "/growth-reviews",
  /** 7.1 GET 날짜별 성장 리뷰. practiceDate는 YYYY-MM-DD */
  byDate: (practiceDate: string) => `/growth-reviews/${practiceDate}`,
} as const;

/** 8. 관리자 중 회원이 쓰는 공지 · 스트릭 유지권(백엔드 8. 관리자) */
export const noticeEndpoints = {
  /** 8.8 GET 공지 목록 */
  root: "/notices",
  /** 8.9 POST 공지 확인 */
  read: (noticeId: Id) => `/notices/${noticeId}/read`,
} as const;

export const streakFreezeEndpoints = {
  /** 8.13 GET 내 스트릭 유지권 */
  mine: "/users/me/streak-freezes",
  /** 8.14 POST 유지권 사용 */
  use: "/users/me/streak-freezes/use",
} as const;

/** 9. 문의(회원 · 비회원). 비회원은 9.3 · 9.4 · 9.5에 X-Inquiry-Password 헤더를 보낸다 */
export const inquiryEndpoints = {
  /** 9.1 POST 문의 작성(토큰 없이도) · 9.2 GET 내 문의 목록(page · size) */
  root: "/inquiries",
  /** 9.3 GET 문의 조회(토큰 없이도) */
  detail: (inquiryId: Id) => `/inquiries/${inquiryId}`,
  /** 9.4 POST 문의 이어서 쓰기(토큰 없이도) */
  messages: (inquiryId: Id) => `/inquiries/${inquiryId}/messages`,
  /** 9.5 POST 문의 종료(토큰 없이도) */
  close: (inquiryId: Id) => `/inquiries/${inquiryId}/close`,
  /** 9.11 POST 문의 사진 업로드 주소(토큰 없이도) */
  attachmentUploadUrl: "/inquiries/attachments/upload-url",
} as const;

export const endpoints = {
  auth: authEndpoints,
  users: userEndpoints,
  home: homeEndpoints,
  applications: applicationEndpoints,
  interviews: interviewEndpoints,
  results: resultEndpoints,
  growthReviews: growthReviewEndpoints,
  notices: noticeEndpoints,
  streakFreezes: streakFreezeEndpoints,
  inquiries: inquiryEndpoints,
} as const;
