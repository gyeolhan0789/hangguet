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

export type AdminMetricsResponse = {
  date: string
  users: { total: number; joinedToday: number }
  practice: { practicedToday: number; daily: { date: string; users: number }[] }
  interviews: {
    total: number
    completed: number
    analyzing: number
    failed: number
    aborted: number
    video: number
    chat: number
  }
  averageScores: { criterion: Criterion; score: number }[]
  streakFreezes: { granted: number; used: number; expired: number }
  notices: { id: number; title: string; readCount: number }[]
}

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

export type Page<T> = {
  content: T[]
  page: { size: number; number: number; totalElements: number; totalPages: number }
}
