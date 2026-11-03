// 관리 API 응답 · 요청 형식(백엔드 8. 관리자 Swagger와 같음)

export type ProblemDetail = {
  title?: string
  status?: number
  detail?: string
  instance?: string
  code?: string
  errors?: { field: string; reason: string }[]
}

export type AdminSummary = { id: number; loginId: string; name: string }

export type AdminTokenResponse = {
  accessToken: string
  expiresIn: number
  admin: AdminSummary
}

export type Criterion = 'JOB_FIT' | 'COVER_LETTER' | 'LOGIC' | 'DELIVERY'

export type Persona = 'DEVIL' | 'COFFEE_CHAT' | 'DUCK'

export type AdminMetricsResponse = {
  date: string
  users: { total: number; joinedToday: number; withdrawn: number; interviewed: number }
  practice: {
    practicedToday: number
    practicedWeek: number
    daily: { date: string; users: number }[]
    retention: { days: number; eligible: number; returned: number }[]
  }
  interviews: {
    total: number
    completed: number
    analyzing: number
    failed: number
    aborted: number
    video: number
    chat: number
    stuck: number
    personas: { persona: Persona; count: number }[]
  }
  averageScores: { criterion: Criterion; score: number }[]
  /** 값이 있는 면접이 없으면 그 지표는 null */
  speech: {
    sessions: number
    fillerPerMin: number | null
    longPauseCount: number | null
    speedDeviationPct: number | null
    trailingOffRatio: number | null
    pitchRangeSt: number | null
    gazeRatio: number | null
  }
  applications: number
  inquiries: { waiting: number }
  streakFreezes: { granted: number; used: number; expired: number }
  notices: { id: number; title: string; readCount: number }[]
}

/** 8.16 그날 0시 기록. 비율 대신 분자 · 분모 */
export type DailyMetric = {
  date: string
  usersTotal: number
  usersJoined: number
  usersWithdrawn: number
  usersInterviewed: number
  practicedUsers: number
  practicedWeek: number
  d1Eligible: number
  d1Returned: number
  d3Eligible: number
  d3Returned: number
  d7Eligible: number
  d7Returned: number
  interviewsTotal: number
  interviewsCompleted: number
  interviewsFailed: number
  interviewsAborted: number
  interviewsStuck: number
  applications: number
  inquiriesWaiting: number
  freezesGranted: number
  freezesUsed: number
  recordedAt: string
}

export type DailyMetricsResponse = { from: string; to: string; content: DailyMetric[] }

export type NoticeListItem = {
  id: number
  title: string
  startsAt: string
  endsAt: string | null
  createdAt: string
}

export type NoticeResponse = NoticeListItem & {
  content: string
  adminName: string
  updatedAt: string
}

export type NoticeCreateRequest = {
  title: string
  content: string
  startsAt: string
  endsAt: string | null
}

/** 보낸 필드만 바꾼다. endsAt은 null을 보내면 지워 계속 보여 준다 */
export type NoticeUpdateRequest = Partial<NoticeCreateRequest>

export type GrantTarget = 'ALL' | 'USERS'
export type GrantStatus = 'SCHEDULED' | 'GRANTED'

export type StreakFreezeGrant = {
  id: number
  targetType: GrantTarget
  targetCount: number
  quantity: number
  grantDate: string
  fillableDate: string
  reason: string | null
  status: GrantStatus
  adminName: string
  createdAt: string
  grantedAt: string | null
}

export type StreakFreezeGrantRequest = {
  targetType: GrantTarget
  userIds: number[] | null
  quantity: number
  grantDate: string
  fillableDate: string
  reason: string | null
}

export type AdminUser = { id: number; email: string; nickname: string; createdAt: string }

// 9. 문의(관리자 9.6 ~ 9.10)
export type InquiryStatus = 'WAITING' | 'ANSWERED' | 'CLOSED'
export type AuthorType = 'USER' | 'ADMIN'

export type AdminInquiryListItem = {
  id: number
  title: string
  status: InquiryStatus
  /** 비회원 문의면 null */
  userId: number | null
  email: string
  createdAt: string
  updatedAt: string
}

/** 메시지에 붙인 사진. url은 1시간 동안 쓰는 원본 주소 */
export type InquiryAttachment = { id: number; url: string }

export type AdminInquiryMessage = {
  id: number
  authorType: AuthorType
  /** 문의한 사람이 쓴 메시지면 null */
  adminName: string | null
  content: string
  createdAt: string
  /** 붙인 순. 없으면 빈 목록 */
  attachments: InquiryAttachment[]
}

export type AdminInquiryResponse = AdminInquiryListItem & {
  /** 비회원 문의면 null */
  nickname: string | null
  messages: AdminInquiryMessage[]
}

export type AdminPasswordChangeRequest = { newPassword: string; inquiryId: number | null }

export type Page<T> = {
  content: T[]
  page: { size: number; number: number; totalElements: number; totalPages: number }
}
