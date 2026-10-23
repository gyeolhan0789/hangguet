// 자동 생성 파일(scripts/swagger-type-examples.mjs). 직접 고치지 않는다.
// 웹 Swagger의 요청 · 응답 예시 129개를 src/types/api 타입으로 적는다. tsc가 하나라도 맞지 않으면 실패한다.
import type {
  AnswerAudioUploadUrlRequest,
  AnswerRequest,
  AnswerResponse,
  ApplicationCreateRequest,
  ApplicationListResponse,
  ApplicationResponse,
  ApplicationUpdateRequest,
  EmailAvailabilityResponse,
  GrowthReviewResponse,
  HomeResponse,
  LoginRequest,
  LogoutRequest,
  MeResponse,
  NicknameChangeResponse,
  NicknameRequest,
  PasswordChangeRequest,
  PendingResponse,
  PracticeLogsResponse,
  ProblemDetail,
  ProfileImageRequest,
  ProfileImageUploadUrlRequest,
  QuestionResponse,
  ReactionRequest,
  ReactionResponse,
  RecentReviewsResponse,
  RecordingCreateRequest,
  RecordingResponse,
  RecordingUploadUrlRequest,
  RefreshRequest,
  RefreshResponse,
  ReplayResponse,
  ResultResponse,
  SessionCalendarResponse,
  SessionCreateRequest,
  SessionListResponse,
  SessionResponse,
  SignupRequest,
  StatsResponse,
  SttTokenResponse,
  TokenResponse,
  TtsTokenResponse,
  UploadUrlResponse,
  WithdrawRequest,
} from "..";

export const SWAGGER_EXAMPLE_COUNT = 129;

export const swaggerExamples = [
  // 1.1 이메일 사용 가능 여부 200
  { available: true } satisfies EmailAvailabilityResponse,
  // 1.2 회원가입 요청
  {
    email: "a@ssafy.com",
    password: "abcd1234",
    nickname: "면접왕",
    agreements: [
      { termsType: "TERMS", termsVersion: "1.0" },
      { termsType: "PRIVACY", termsVersion: "1.0" },
      { termsType: "RECORDING", termsVersion: "1.0" },
    ],
  } satisfies SignupRequest,
  // 1.2 회원가입 201
  {
    accessToken: "eyJ…",
    refreshToken: "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10",
    expiresIn: 3600,
    user: { id: 1, email: "a@ssafy.com", nickname: "면접왕", profileImageUrl: null },
  } satisfies TokenResponse,
  // 1.2 회원가입 400 AGREEMENT_REQUIRED
  {
    title: "Bad Request",
    status: 400,
    detail: "필수 약관에 모두 동의해 주세요.",
    instance: "/api/v1/auth/signup",
    code: "AGREEMENT_REQUIRED",
  } satisfies ProblemDetail,
  // 1.2 회원가입 400 VALIDATION_FAILED
  {
    title: "Bad Request",
    status: 400,
    detail: "입력값을 확인해 주세요.",
    instance: "/api/v1/auth/signup",
    code: "VALIDATION_FAILED",
    errors: [{ field: "password", reason: "8~64자, 영문과 숫자를 모두 포함해야 합니다." }],
  } satisfies ProblemDetail,
  // 1.2 회원가입 409 EMAIL_DUPLICATED
  {
    title: "Conflict",
    status: 409,
    detail: "이미 사용 중인 이메일이에요.",
    instance: "/api/v1/auth/signup",
    code: "EMAIL_DUPLICATED",
  } satisfies ProblemDetail,
  // 1.3 로그인 요청 스키마 example
  { email: "a@ssafy.com", password: "abcd1234" } satisfies LoginRequest,
  // 1.3 로그인 200
  {
    accessToken: "eyJ…",
    refreshToken: "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10",
    expiresIn: 3600,
    user: { id: 1, email: "a@ssafy.com", nickname: "면접왕", profileImageUrl: null },
  } satisfies TokenResponse,
  // 1.3 로그인 401 LOGIN_FAILED
  {
    title: "Unauthorized",
    status: 401,
    detail: "이메일 또는 비밀번호를 확인해 주세요.",
    instance: "/api/v1/auth/login",
    code: "LOGIN_FAILED",
  } satisfies ProblemDetail,
  // 1.4 토큰 재발급 요청 스키마 example
  { refreshToken: "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10" } satisfies RefreshRequest,
  // 1.4 토큰 재발급 200
  {
    accessToken: "eyJ…",
    refreshToken: "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10",
    expiresIn: 3600,
  } satisfies RefreshResponse,
  // 1.4 토큰 재발급 401 REFRESH_TOKEN_INVALID
  {
    title: "Unauthorized",
    status: 401,
    detail: "다시 로그인해 주세요.",
    instance: "/api/v1/auth/token/refresh",
    code: "REFRESH_TOKEN_INVALID",
  } satisfies ProblemDetail,
  // 1.5 로그아웃 요청 스키마 example
  { refreshToken: "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10" } satisfies LogoutRequest,
  // 2.1 내 정보 200
  {
    id: 1,
    email: "example@ssafy.com",
    nickname: "면접왕",
    profileImageUrl: "https://…",
    createdAt: "2026-09-01T10:00:00+09:00",
    currentStreak: 7,
  } satisfies MeResponse,
  // 2.7 회원 탈퇴 요청 스키마 example
  { password: "abcd1234" } satisfies WithdrawRequest,
  // 2.7 회원 탈퇴 400 PASSWORD_MISMATCH
  {
    title: "Bad Request",
    status: 400,
    detail: "비밀번호가 맞지 않아요.",
    instance: "/api/v1/users/me/password",
    code: "PASSWORD_MISMATCH",
  } satisfies ProblemDetail,
  // 2.2 닉네임 변경 요청 스키마 example
  { nickname: "면접왕" } satisfies NicknameRequest,
  // 2.2 닉네임 변경 200
  {
    id: 1,
    email: "example@ssafy.com",
    nickname: "면접왕",
    profileImageUrl: "https://…",
    createdAt: "2026-09-01T10:00:00+09:00",
    currentStreak: 7,
    accessToken: "eyJ…",
    expiresIn: 3600,
  } satisfies NicknameChangeResponse,
  // 2.3 비밀번호 변경 요청 스키마 example
  { currentPassword: "abcd1234", newPassword: "efgh5678" } satisfies PasswordChangeRequest,
  // 2.3 비밀번호 변경 400 PASSWORD_MISMATCH
  {
    title: "Bad Request",
    status: 400,
    detail: "비밀번호가 맞지 않아요.",
    instance: "/api/v1/users/me/password",
    code: "PASSWORD_MISMATCH",
  } satisfies ProblemDetail,
  // 2.4 프로필 사진 업로드 주소 요청 스키마 example
  { contentType: "image/png", size: 204800 } satisfies ProfileImageUploadUrlRequest,
  // 2.4 프로필 사진 업로드 주소 200
  {
    uploadUrl: "https://…s3…?X-Amz-Signature=…",
    objectKey: "profile/1/7f3c….png",
    expiresAt: "2026-10-15T12:10:00+09:00",
  } satisfies UploadUrlResponse,
  // 2.5 프로필 사진 등록 요청 스키마 example
  { objectKey: "profile/1/7f3c….png" } satisfies ProfileImageRequest,
  // 2.5 프로필 사진 등록 200
  {
    id: 1,
    email: "example@ssafy.com",
    nickname: "면접왕",
    profileImageUrl: "https://…",
    createdAt: "2026-09-01T10:00:00+09:00",
    currentStreak: 7,
  } satisfies MeResponse,
  // 2.5 프로필 사진 등록 404 FILE_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "업로드한 파일을 찾을 수 없어요.",
    instance: "/api/v1/users/me/profile-image",
    code: "FILE_NOT_FOUND",
  } satisfies ProblemDetail,
  // 3.1 홈 200 S02 오늘 미완료
  {
    homeState: "NOT_DONE_TODAY",
    currentStreak: 7,
    bestStreak: 7,
    practiceDates: [
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ],
    todayInterviewCount: 0,
    todayPracticeMinutes: 0,
    todayImprovements: [],
    nextActions: ["꼬리 질문엔 근거부터 짧게"],
    nextActionsDate: "2026-10-14",
    recentReviews: [
      { practiceDate: "2026-10-14", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
      { practiceDate: "2026-10-13", companyName: "△△소프트", criterion: "LOGIC", delta: 4 },
    ],
  } satisfies HomeResponse,
  // 3.1 홈 200 S02-B 오늘 완료
  {
    homeState: "DONE_TODAY",
    currentStreak: 8,
    bestStreak: 8,
    practiceDates: [
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
    ],
    todayInterviewCount: 1,
    todayPracticeMinutes: 18,
    todayImprovements: [
      { criterion: "DELIVERY", delta: 8 },
      { criterion: "LOGIC", delta: 4 },
    ],
    nextActions: ["꼬리 질문엔 근거부터 짧게", "직무 적합성 질문 1개 더 연습하기"],
    nextActionsDate: "2026-10-15",
    recentReviews: [
      { practiceDate: "2026-10-15", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
      { practiceDate: "2026-10-14", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
    ],
  } satisfies HomeResponse,
  // 3.1 홈 200 S02-C 스트릭 끊김
  {
    homeState: "BROKEN",
    currentStreak: 0,
    bestStreak: 7,
    practiceDates: ["2026-10-10", "2026-10-11", "2026-10-12"],
    todayInterviewCount: 0,
    todayPracticeMinutes: 0,
    todayImprovements: [],
    nextActions: ["꼬리 질문엔 근거부터 짧게"],
    nextActionsDate: "2026-10-12",
    recentReviews: [
      { practiceDate: "2026-10-12", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
      { practiceDate: "2026-10-11", companyName: "△△소프트", criterion: "LOGIC", delta: 4 },
    ],
  } satisfies HomeResponse,
  // 3.1 홈 200 S02-D 첫 방문
  {
    homeState: "FIRST_VISIT",
    currentStreak: 0,
    bestStreak: 0,
    practiceDates: [],
    todayInterviewCount: 0,
    todayPracticeMinutes: 0,
    todayImprovements: [],
    nextActions: [],
    nextActionsDate: null,
    recentReviews: [],
  } satisfies HomeResponse,
  // 3.2 통계 200
  {
    currentStreak: 7,
    bestStreak: 12,
    totalInterviewCount: 23,
    totalPracticeMinutes: 400,
    latestJobTitle: "백엔드 개발자",
  } satisfies StatsResponse,
  // 3.3 연습 달력 200 한국 시간 시작일 기준
  {
    content: [
      { practiceDate: "2026-10-20", createdAt: "2026-10-20T20:10:00+09:00" },
      { practiceDate: "2026-10-21", createdAt: "2026-10-21T19:42:00+09:00" },
    ],
  } satisfies PracticeLogsResponse,
  // 4.3 지원서 목록 200
  {
    content: [
      {
        id: 12,
        companyName: "○○전자",
        jobTitle: "백엔드 개발자",
        createdAt: "2026-10-15T11:55:00+09:00",
        inUse: false,
      },
      {
        id: 9,
        companyName: "△△소프트",
        jobTitle: "서버 개발자",
        createdAt: "2026-10-11T20:10:00+09:00",
        inUse: true,
      },
    ],
    page: { size: 10, number: 0, totalElements: 2, totalPages: 1 },
  } satisfies ApplicationListResponse,
  // 4.1 지원서 작성 요청 스키마 example
  {
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    coverLetter: "1. 지원 동기\n저는…",
  } satisfies ApplicationCreateRequest,
  // 4.1 지원서 작성 201
  {
    id: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    coverLetter: "1. 지원 동기\n저는…",
    createdAt: "2026-10-15T11:55:00+09:00",
    inUse: false,
  } satisfies ApplicationResponse,
  // 4.2 지원서 조회 200
  {
    id: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    coverLetter: "1. 지원 동기\n저는…",
    createdAt: "2026-10-15T11:55:00+09:00",
    inUse: false,
  } satisfies ApplicationResponse,
  // 4.2 지원서 조회 404 APPLICATION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "지원서를 찾을 수 없어요.",
    instance: "/api/v1/applications/0",
    code: "APPLICATION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 4.5 지원서 삭제 404 APPLICATION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "지원서를 찾을 수 없어요.",
    instance: "/api/v1/applications/0",
    code: "APPLICATION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 4.5 지원서 삭제 409 APPLICATION_IN_USE
  {
    title: "Conflict",
    status: 409,
    detail: "면접에 사용한 지원서는 수정하거나 삭제할 수 없어요.",
    instance: "/api/v1/applications/9",
    code: "APPLICATION_IN_USE",
  } satisfies ProblemDetail,
  // 4.4 지원서 수정 요청 스키마 example
  {
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    coverLetter: "1. 지원 동기(수정)\n저는…",
  } satisfies ApplicationUpdateRequest,
  // 4.4 지원서 수정 200
  {
    id: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    coverLetter: "1. 지원 동기\n저는…",
    createdAt: "2026-10-15T11:55:00+09:00",
    inUse: false,
  } satisfies ApplicationResponse,
  // 4.4 지원서 수정 404 APPLICATION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "지원서를 찾을 수 없어요.",
    instance: "/api/v1/applications/0",
    code: "APPLICATION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 4.4 지원서 수정 409 APPLICATION_IN_USE
  {
    title: "Conflict",
    status: 409,
    detail: "면접에 사용한 지원서는 수정하거나 삭제할 수 없어요.",
    instance: "/api/v1/applications/9",
    code: "APPLICATION_IN_USE",
  } satisfies ProblemDetail,
  // 5.13 연습 면접 목록 200 완료·분석 중
  {
    content: [
      {
        id: 55,
        companyName: "○○전자",
        jobTitle: "백엔드 개발자",
        persona: "DEVIL",
        mode: "VIDEO",
        status: "COMPLETED",
        startedAt: "2026-10-21T23:50:00+09:00",
        endedAt: "2026-10-22T00:10:00+09:00",
        answeredCount: 5,
        summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
        criterionGrades: [
          { criterion: "JOB_FIT", grade: "GOOD" },
          { criterion: "COVER_LETTER", grade: "WEAK" },
          { criterion: "LOGIC", grade: "GOOD" },
          { criterion: "DELIVERY", grade: "NORMAL" },
        ],
      },
      {
        id: 54,
        companyName: "△△소프트",
        jobTitle: "서버 개발자",
        persona: "COFFEE_CHAT",
        mode: "CHAT",
        status: "ANALYZING",
        startedAt: "2026-10-21T19:30:00+09:00",
        endedAt: "2026-10-21T19:42:00+09:00",
        answeredCount: 3,
        summary: null,
        criterionGrades: [],
      },
    ],
    page: { size: 5, number: 0, totalElements: 2, totalPages: 1 },
    summary: { totalInterviewCount: 4, practiceMinutes: 32 },
  } satisfies SessionListResponse,
  // 5.13 연습 면접 목록 200 기록 없는 날짜
  {
    content: [],
    page: { size: 5, number: 0, totalElements: 0, totalPages: 0 },
    summary: { totalInterviewCount: 4, practiceMinutes: 0 },
  } satisfies SessionListResponse,
  // 5.1 면접 만들기 요청
  { applicationId: 10, persona: "DEVIL", mode: "VIDEO" } satisfies SessionCreateRequest,
  // 5.1 면접 만들기 201
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "READY",
    planStatus: "GENERATING",
    planProgress: 0,
    analysisStep: null,
    currentQuestion: null,
    answeredCount: 0,
    elapsedSeconds: 0,
    startedAt: null,
    endedAt: null,
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.1 면접 만들기 404 APPLICATION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "지원서를 찾을 수 없어요.",
    instance: "/api/v1/applications/0",
    code: "APPLICATION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.1 면접 만들기 409 IDEMPOTENCY_KEY_REUSED
  {
    title: "Conflict",
    status: 409,
    detail: "이미 처리된 요청이에요.",
    instance: "/api/v1/interview-sessions",
    code: "IDEMPOTENCY_KEY_REUSED",
  } satisfies ProblemDetail,
  // 5.2 면접 조회 200 S05·S05-E 질문 준비 78%
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "READY",
    planStatus: "GENERATING",
    planProgress: 78,
    analysisStep: null,
    currentQuestion: null,
    answeredCount: 0,
    elapsedSeconds: 0,
    startedAt: null,
    endedAt: null,
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.2 면접 조회 200 S05 플랜 생성 실패
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "READY",
    planStatus: "FAILED",
    planProgress: null,
    analysisStep: null,
    currentQuestion: null,
    answeredCount: 0,
    elapsedSeconds: 0,
    startedAt: null,
    endedAt: null,
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.2 면접 조회 200 S06·S06-B 면접 중
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "IN_PROGRESS",
    planStatus: "READY",
    planProgress: null,
    analysisStep: null,
    currentQuestion: { id: 303, seq: 3, content: "가장 큰 기술적 문제는 무엇이었나요?" },
    answeredCount: 2,
    elapsedSeconds: 522,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: null,
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.2 면접 조회 200 S06 다음 질문 생성 중
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "IN_PROGRESS",
    planStatus: "READY",
    planProgress: null,
    analysisStep: null,
    currentQuestion: null,
    answeredCount: 3,
    elapsedSeconds: 640,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: null,
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.2 면접 조회 200 S06-1 결과 분석 중
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "ANALYZING",
    planStatus: "READY",
    planProgress: null,
    analysisStep: "SCORING",
    currentQuestion: null,
    answeredCount: 5,
    elapsedSeconds: 1080,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:18:00+09:00",
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.2 면접 조회 200 S06-1 실패
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "FAILED",
    planStatus: "READY",
    planProgress: null,
    analysisStep: null,
    currentQuestion: null,
    answeredCount: 5,
    elapsedSeconds: 1080,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:18:00+09:00",
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.2 면접 조회 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.3 면접 플랜 재생성 202
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "READY",
    planStatus: "GENERATING",
    planProgress: 0,
    analysisStep: null,
    currentQuestion: null,
    answeredCount: 0,
    elapsedSeconds: 0,
    startedAt: null,
    endedAt: null,
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.3 면접 플랜 재생성 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.3 면접 플랜 재생성 409 PLAN_NOT_FAILED
  {
    title: "Conflict",
    status: 409,
    detail: "면접 준비가 실패한 상태가 아니에요.",
    instance: "/api/v1/interview-sessions/55/plan/retry",
    code: "PLAN_NOT_FAILED",
  } satisfies ProblemDetail,
  // 5.4 면접 시작 200
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "IN_PROGRESS",
    planStatus: "READY",
    planProgress: null,
    analysisStep: null,
    currentQuestion: { id: 301, seq: 1, content: "1분 동안 자기소개 부탁드려요." },
    answeredCount: 0,
    elapsedSeconds: 0,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: null,
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.4 면접 시작 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.4 면접 시작 409 PLAN_NOT_READY
  {
    title: "Conflict",
    status: 409,
    detail: "면접관이 질문을 준비하고 있어요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "PLAN_NOT_READY",
  } satisfies ProblemDetail,
  // 5.4 면접 시작 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.4 면접 시작 409 IDEMPOTENCY_KEY_REUSED
  {
    title: "Conflict",
    status: 409,
    detail: "이미 처리된 요청이에요.",
    instance: "/api/v1/interview-sessions",
    code: "IDEMPOTENCY_KEY_REUSED",
  } satisfies ProblemDetail,
  // 5.5 지금 질문 200
  {
    id: 303,
    seq: 3,
    content: "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
    createdAt: "2026-10-15T12:06:12+09:00",
  } satisfies QuestionResponse,
  // 5.5 지금 질문 202
  { code: "QUESTION_GENERATING" } satisfies PendingResponse,
  // 5.5 지금 질문 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.5 지금 질문 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.6 답변 음성 업로드 주소 요청 스키마 example
  { contentType: "audio/webm" } satisfies AnswerAudioUploadUrlRequest,
  // 5.6 답변 음성 업로드 주소 200
  {
    uploadUrl: "https://…s3…?X-Amz-Signature=…",
    objectKey: "sessions/55/answers/303.webm",
    expiresAt: "2026-10-15T12:16:12+09:00",
  } satisfies UploadUrlResponse,
  // 5.6 답변 음성 업로드 주소 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.6 답변 음성 업로드 주소 404 QUESTION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "질문을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/55/questions/0/answer",
    code: "QUESTION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.6 답변 음성 업로드 주소 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.7 답변 제출 요청 S06 화상
  {
    inputType: "VOICE",
    content: "조회 응답 시간을 40% 줄였습니다.",
    audioObjectKey: "sessions/55/answers/303.webm",
    tokens: [
      { text: "조회", startMs: 0, endMs: 280 },
      { text: " ", startMs: 280, endMs: 320 },
      { text: "응답", startMs: 320, endMs: 600 },
      { text: " ", startMs: 600, endMs: 640 },
      { text: "시간", startMs: 640, endMs: 900 },
      { text: "을", startMs: 900, endMs: 1000 },
      { text: " ", startMs: 1000, endMs: 1180 },
      { text: "40", startMs: 1180, endMs: 1500 },
      { text: "%", startMs: 1500, endMs: 1700 },
      { text: " ", startMs: 1700, endMs: 1740 },
      { text: "줄", startMs: 1740, endMs: 1900 },
      { text: "였", startMs: 1900, endMs: 2050 },
      { text: "습니다", startMs: 2050, endMs: 2400 },
      { text: ".", startMs: 2400, endMs: 2400 },
    ],
  } satisfies AnswerRequest,
  // 5.7 답변 제출 요청 S06-B 채팅
  { inputType: "TEXT", content: "캐시 무효화 시점을 직접 설계했습니다." } satisfies AnswerRequest,
  // 5.7 답변 제출 202
  {
    id: 903,
    questionId: 303,
    inputType: "VOICE",
    createdAt: "2026-10-15T12:08:40+09:00",
    isLastQuestion: false,
  } satisfies AnswerResponse,
  // 5.7 답변 제출 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.7 답변 제출 404 QUESTION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "질문을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/55/questions/0/answer",
    code: "QUESTION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.7 답변 제출 404 FILE_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "업로드한 파일을 찾을 수 없어요.",
    instance: "/api/v1/users/me/profile-image",
    code: "FILE_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.7 답변 제출 409 ANSWER_ALREADY_SUBMITTED
  {
    title: "Conflict",
    status: 409,
    detail: "이미 답변한 질문이에요.",
    instance: "/api/v1/interview-sessions/55/questions/303/answer",
    code: "ANSWER_ALREADY_SUBMITTED",
  } satisfies ProblemDetail,
  // 5.7 답변 제출 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.7 답변 제출 409 IDEMPOTENCY_KEY_REUSED
  {
    title: "Conflict",
    status: 409,
    detail: "이미 처리된 요청이에요.",
    instance: "/api/v1/interview-sessions",
    code: "IDEMPOTENCY_KEY_REUSED",
  } satisfies ProblemDetail,
  // 5.8 면접 끝내기 200 답변 0개 → 홈
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "ABORTED",
    planStatus: "READY",
    planProgress: null,
    analysisStep: null,
    currentQuestion: null,
    answeredCount: 0,
    elapsedSeconds: 95,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:01:35+09:00",
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: false,
  } satisfies SessionResponse,
  // 5.8 면접 끝내기 202 S06-E 답변한 2개까지 → S06-1
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "ANALYZING",
    planStatus: "READY",
    planProgress: null,
    analysisStep: "ORGANIZING_ANSWERS",
    currentQuestion: null,
    answeredCount: 2,
    elapsedSeconds: 522,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:08:42+09:00",
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: true,
  } satisfies SessionResponse,
  // 5.8 면접 끝내기 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.8 면접 끝내기 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.8 면접 끝내기 409 IDEMPOTENCY_KEY_REUSED
  {
    title: "Conflict",
    status: 409,
    detail: "이미 처리된 요청이에요.",
    instance: "/api/v1/interview-sessions",
    code: "IDEMPOTENCY_KEY_REUSED",
  } satisfies ProblemDetail,
  // 5.9 결과 재생성 202
  {
    id: 55,
    applicationId: 10,
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    persona: "DEVIL",
    mode: "VIDEO",
    status: "ANALYZING",
    planStatus: "READY",
    planProgress: null,
    analysisStep: "SCORING",
    currentQuestion: null,
    answeredCount: 5,
    elapsedSeconds: 1080,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:18:00+09:00",
    createdAt: "2026-10-15T11:58:30+09:00",
    leveledUp: null,
  } satisfies SessionResponse,
  // 5.9 결과 재생성 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.9 결과 재생성 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.10 실시간 음성 인식 토큰 200
  { token: "…", expiresAt: "2026-10-15T12:16:00+09:00" } satisfies SttTokenResponse,
  // 5.10 실시간 음성 인식 토큰 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.10 실시간 음성 인식 토큰 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.10 실시간 음성 인식 토큰 503 STT_UNAVAILABLE
  {
    title: "Service Unavailable",
    status: 503,
    detail: "음성 인식을 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    instance: "/api/v1/interview-sessions/55/stt-token",
    code: "STT_UNAVAILABLE",
  } satisfies ProblemDetail,
  // 5.11 면접관 리액션 요청 S06 화상
  {
    seq: 3,
    text: "그래서 조회 응답 시간을 40% 줄였습니다.",
    pauseMs: 420,
  } satisfies ReactionRequest,
  // 5.11 면접관 리액션 요청 S06-B 채팅
  {
    seq: 7,
    text: "캐시 무효화 시점을 직접 설계했고, 그 결과",
    pauseMs: 800,
  } satisfies ReactionRequest,
  // 5.11 면접관 리액션 200 리액션 있음 (끄덕임)
  {
    seq: 3,
    reaction: {
      type: "gesture",
      state: null,
      expression: null,
      gesture: "nod",
      intensity: 0.6,
      durationMs: 1200,
      ttlMs: 1500,
      source: "server",
    },
    attitude: { interest: 0.7, trust: 0.6, tension: 0.2 },
    interrupt: null,
  } satisfies ReactionResponse,
  // 5.11 면접관 리액션 200 리액션 없음
  {
    seq: 4,
    reaction: null,
    attitude: { interest: 0.7, trust: 0.6, tension: 0.2 },
    interrupt: null,
  } satisfies ReactionResponse,
  // 5.11 면접관 리액션 200 말 끊기
  {
    seq: 9,
    reaction: {
      type: "expression",
      state: null,
      expression: "frown",
      gesture: null,
      intensity: 0.5,
      durationMs: 1500,
      ttlMs: 1500,
      source: "server",
    },
    attitude: { interest: 0.4, trust: 0.5, tension: 0.6 },
    interrupt: { reason: "OFF_TOPIC", text: "질문으로 다시 돌아가 볼게요." },
  } satisfies ReactionResponse,
  // 5.11 면접관 리액션 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.11 면접관 리액션 404 QUESTION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "질문을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/55/questions/0/answer",
    code: "QUESTION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.11 면접관 리액션 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.11 면접관 리액션 409 ANSWER_ALREADY_SUBMITTED
  {
    title: "Conflict",
    status: 409,
    detail: "이미 답변한 질문이에요.",
    instance: "/api/v1/interview-sessions/55/questions/303/answer",
    code: "ANSWER_ALREADY_SUBMITTED",
  } satisfies ProblemDetail,
  // 5.12 질문 음성 토큰 200
  {
    token: "…",
    expiresAt: "2026-10-15T12:21:12+09:00",
    voiceId: "…",
    modelId: "…",
  } satisfies TtsTokenResponse,
  // 5.12 질문 음성 토큰 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.12 질문 음성 토큰 404 QUESTION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "질문을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/55/questions/0/answer",
    code: "QUESTION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 5.12 질문 음성 토큰 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 5.12 질문 음성 토큰 503 TTS_UNAVAILABLE
  {
    title: "Service Unavailable",
    status: 503,
    detail: "질문 음성을 불러오지 못했어요. 글로 보여 드릴게요.",
    instance: "/api/v1/interview-sessions/55/questions/303/tts-token",
    code: "TTS_UNAVAILABLE",
  } satisfies ProblemDetail,
  // 5.15 월별 연습 면접 횟수 200 스키마 example
  {
    month: "2026-10",
    content: [{ practiceDate: "2026-10-01", interviewCount: 0 }],
  } satisfies SessionCalendarResponse,
  // 6.1 녹화 업로드 주소 요청 스키마 example
  { contentType: "video/webm" } satisfies RecordingUploadUrlRequest,
  // 6.1 녹화 업로드 주소 200
  {
    uploadUrl: "https://…s3…?X-Amz-Signature=…",
    objectKey: "sessions/55/session.webm",
    expiresAt: "2026-10-15T12:48:00+09:00",
  } satisfies UploadUrlResponse,
  // 6.1 녹화 업로드 주소 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 6.1 녹화 업로드 주소 409 INVALID_SESSION_STATE
  {
    title: "Conflict",
    status: 409,
    detail: "지금은 할 수 없는 요청이에요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "INVALID_SESSION_STATE",
  } satisfies ProblemDetail,
  // 6.2 녹화 등록 요청 스키마 example
  {
    recordingType: "SESSION_VIDEO",
    objectKey: "sessions/55/session.webm",
  } satisfies RecordingCreateRequest,
  // 6.2 녹화 등록 201
  {
    id: 77,
    recordingType: "SESSION_VIDEO",
    createdAt: "2026-10-15T12:18:30+09:00",
  } satisfies RecordingResponse,
  // 6.2 녹화 등록 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 6.2 녹화 등록 404 FILE_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "업로드한 파일을 찾을 수 없어요.",
    instance: "/api/v1/users/me/profile-image",
    code: "FILE_NOT_FOUND",
  } satisfies ProblemDetail,
  // 6.2 녹화 등록 409 RECORDING_ALREADY_EXISTS
  {
    title: "Conflict",
    status: 409,
    detail: "이미 녹화가 등록된 면접이에요.",
    instance: "/api/v1/interview-sessions/55/recordings",
    code: "RECORDING_ALREADY_EXISTS",
  } satisfies ProblemDetail,
  // 6.3 면접 결과 200 S07 화상 면접 결과
  {
    id: 55,
    persona: "DEVIL",
    mode: "VIDEO",
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:18:00+09:00",
    sessionScores: [
      { criterion: "JOB_FIT", score: 82, grade: "GOOD", comment: "직무 경험을 수치로 설명했어요" },
      { criterion: "COVER_LETTER", score: 58, grade: "WEAK", comment: "꼬리 질문엔 근거부터 짧게" },
      { criterion: "LOGIC", score: 80, grade: "GOOD", comment: "결론부터 말했어요" },
      { criterion: "DELIVERY", score: 70, grade: "NORMAL", comment: "말 끊김이 줄었어요" },
    ],
    answers: [
      {
        questionId: 301,
        seq: 1,
        question: "1분 자기소개",
        content: "안녕하세요, 저는…",
        score: 84,
        grade: "GOOD",
        goodPoint: "핵심 경험을 1분 안에 정리했어요",
        improvePoint: "지원 동기가 마지막에 짧게만 나왔어요",
      },
      {
        questionId: 302,
        seq: 2,
        question: "○○ 프로젝트에서 맡은 역할은?",
        content: "저는 백엔드를 맡아…",
        score: 85,
        grade: "GOOD",
        goodPoint: "역할과 기여를 수치로 구체적으로 설명했어요",
        improvePoint: "꼬리 질문에서 근거 없이 답이 길어졌어요",
      },
      {
        questionId: 303,
        seq: 3,
        question: "가장 큰 기술적 문제는?",
        content: "캐시 일관성 문제였고…",
        score: 68,
        grade: "NORMAL",
        goodPoint: "문제 상황을 명확히 설명했어요",
        improvePoint: "해결 방법을 고른 이유가 빠졌어요",
      },
      {
        questionId: 304,
        seq: 4,
        question: "백엔드 직무에 지원한 이유는?",
        content: "음… 서버 쪽이…",
        score: 52,
        grade: "WEAK",
        goodPoint: null,
        improvePoint: "자소서 내용과 연결하지 못했어요",
      },
      {
        questionId: 305,
        seq: 5,
        question: "대용량 트래픽 처리 방법은?",
        content: "읽기 부하는 캐시로…",
        score: 81,
        grade: "GOOD",
        goodPoint: "단계별로 설명했어요",
        improvePoint: "실제 수치 예시가 있으면 좋아요",
      },
    ],
    speechMetrics: {
      fillerPerMin: 2.1,
      longPauseCount: 3,
      speedDeviationPct: 8.5,
      trailingOffRatio: 12,
      pitchRangeSt: 6.2,
      gazeRatio: 71.5,
    },
  } satisfies ResultResponse,
  // 6.3 면접 결과 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 6.3 면접 결과 409 RESULT_NOT_READY
  {
    title: "Conflict",
    status: 409,
    detail: "결과를 만들고 있어요.",
    instance: "/api/v1/interview-sessions/55/result",
    code: "RESULT_NOT_READY",
  } satisfies ProblemDetail,
  // 6.3 면접 결과 409 NO_RESULT
  {
    title: "Conflict",
    status: 409,
    detail: "답변 없이 끝난 면접은 결과가 없어요.",
    instance: "/api/v1/interview-sessions/55/result",
    code: "NO_RESULT",
  } satisfies ProblemDetail,
  // 6.4 다시보기 200 S07-1 화상(마커 00:42 · 03:10 · 06:12 · 10:05 · 14:30)
  {
    id: 55,
    persona: "DEVIL",
    mode: "VIDEO",
    companyName: "○○전자",
    jobTitle: "백엔드 개발자",
    startedAt: "2026-10-15T12:00:00+09:00",
    videoUrl: "https://…s3…/sessions/55/session.webm?X-Amz-Signature=…",
    items: [
      {
        questionId: 301,
        seq: 1,
        question: "1분 자기소개",
        questionCreatedAt: "2026-10-15T12:00:42+09:00",
        answer: "안녕하세요, 저는…",
        answerCreatedAt: "2026-10-15T12:02:40+09:00",
        grade: "GOOD",
      },
      {
        questionId: 302,
        seq: 2,
        question: "○○ 프로젝트에서 맡은 역할은?",
        questionCreatedAt: "2026-10-15T12:03:10+09:00",
        answer: "저는 백엔드를 맡아…",
        answerCreatedAt: "2026-10-15T12:05:50+09:00",
        grade: "GOOD",
      },
      {
        questionId: 303,
        seq: 3,
        question: "가장 큰 기술적 문제는?",
        questionCreatedAt: "2026-10-15T12:06:12+09:00",
        answer: "저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…",
        answerCreatedAt: "2026-10-15T12:09:40+09:00",
        grade: "NORMAL",
      },
      {
        questionId: 304,
        seq: 4,
        question: "백엔드 직무에 지원한 이유는?",
        questionCreatedAt: "2026-10-15T12:10:05+09:00",
        answer: "음… 서버 쪽이…",
        answerCreatedAt: "2026-10-15T12:13:50+09:00",
        grade: "WEAK",
      },
      {
        questionId: 305,
        seq: 5,
        question: "대용량 트래픽 처리 방법은?",
        questionCreatedAt: "2026-10-15T12:14:30+09:00",
        answer: "읽기 부하는 캐시로…",
        answerCreatedAt: "2026-10-15T12:17:40+09:00",
        grade: "GOOD",
      },
    ],
  } satisfies ReplayResponse,
  // 6.4 다시보기 404 SESSION_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  } satisfies ProblemDetail,
  // 6.4 다시보기 409 RESULT_NOT_READY
  {
    title: "Conflict",
    status: 409,
    detail: "결과를 만들고 있어요.",
    instance: "/api/v1/interview-sessions/55/result",
    code: "RESULT_NOT_READY",
  } satisfies ProblemDetail,
  // 6.4 다시보기 409 NO_RESULT
  {
    title: "Conflict",
    status: 409,
    detail: "답변 없이 끝난 면접은 결과가 없어요.",
    instance: "/api/v1/interview-sessions/55/result",
    code: "NO_RESULT",
  } satisfies ProblemDetail,
  // 7.1 날짜별 성장 리뷰 200 S08 오늘의 성장 리뷰
  {
    practiceDate: "2026-10-13",
    isFirst: false,
    comparedDate: "2026-10-12",
    streakOnDate: 8,
    practiceDates: [
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
    ],
    interviewCount: 1,
    practiceMinutes: 18,
    criteria: [
      {
        criterion: "DELIVERY",
        score: 70,
        grade: "NORMAL",
        delta: 8,
        comment: "말 끊김이 줄었어요",
      },
      { criterion: "LOGIC", score: 80, grade: "GOOD", delta: 4, comment: "결론부터 말했어요" },
      { criterion: "COVER_LETTER", score: 76, grade: "GOOD", delta: 0, comment: "막힘 없이 통과" },
      {
        criterion: "JOB_FIT",
        score: 62,
        grade: "NORMAL",
        delta: -3,
        comment: "직무 적합성 질문 1개 더 연습하기",
      },
    ],
    nextActions: ["직무 적합성 질문 1개 더 연습하기"],
  } satisfies GrowthReviewResponse,
  // 7.1 날짜별 성장 리뷰 200 S08-C 첫 면접
  {
    practiceDate: "2026-10-15",
    isFirst: true,
    comparedDate: null,
    streakOnDate: 1,
    practiceDates: ["2026-10-15"],
    interviewCount: 1,
    practiceMinutes: 18,
    criteria: [
      {
        criterion: "JOB_FIT",
        score: 82,
        grade: "GOOD",
        delta: null,
        comment: "직무 경험을 수치로 설명했어요",
      },
      {
        criterion: "COVER_LETTER",
        score: 58,
        grade: "WEAK",
        delta: null,
        comment: "꼬리 질문엔 근거부터 짧게",
      },
      { criterion: "LOGIC", score: 80, grade: "GOOD", delta: null, comment: "결론부터 말했어요" },
      {
        criterion: "DELIVERY",
        score: 70,
        grade: "NORMAL",
        delta: null,
        comment: "말 끊김이 줄었어요",
      },
    ],
    nextActions: ["꼬리 질문엔 근거부터 짧게"],
  } satisfies GrowthReviewResponse,
  // 7.1 날짜별 성장 리뷰 404 GROWTH_REVIEW_NOT_FOUND
  {
    title: "Not Found",
    status: 404,
    detail: "그날의 성장 리뷰가 없어요.",
    instance: "/api/v1/growth-reviews/2026-10-01",
    code: "GROWTH_REVIEW_NOT_FOUND",
  } satisfies ProblemDetail,
  // 7.2 최근 성장 리뷰 200
  {
    content: [
      { practiceDate: "2026-10-12", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
      { practiceDate: "2026-10-11", companyName: "△△소프트", criterion: "LOGIC", delta: 4 },
    ],
    page: { size: 2, number: 0, totalElements: 7, totalPages: 4 },
  } satisfies RecentReviewsResponse,
];
