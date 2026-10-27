import { clearSession, loadSession } from './session'
import type {
  AdminInquiryListItem,
  AdminInquiryMessage,
  AdminInquiryResponse,
  AdminPasswordChangeRequest,
  AdminMetricsResponse,
  DailyMetricsResponse,
  AdminTokenResponse,
  AdminUser,
  InquiryStatus,
  NoticeCreateRequest,
  NoticeListItem,
  NoticeResponse,
  NoticeUpdateRequest,
  Page,
  ProblemDetail,
  StreakFreezeGrant,
  StreakFreezeGrantRequest,
} from './types'

// 서버가 실패를 ProblemDetail로 주면 code · detail · errors를 담는다. 네트워크 실패면 problem이 비어 있다.
export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetail

  constructor(status: number, problem: ProblemDetail) {
    super(problem.detail ?? '잠시 후 다시 시도해 주세요.')
    this.status = status
    this.problem = problem
  }
}

let onUnauthorized: () => void = () => {}

/** 토큰이 만료·로그아웃돼 401을 받으면 부른다(로그인 화면으로). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = loadSession()
  let response: Response
  try {
    response = await fetch(`/be/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, {})
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ProblemDetail
    if (response.status === 401 && session) {
      clearSession()
      onUnauthorized()
    }
    throw new ApiError(response.status, problem)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const api = {
  login: (loginId: string, password: string) =>
    request<AdminTokenResponse>('/admin/auth/login', { method: 'POST', body: { loginId, password } }),
  logout: () => request<void>('/admin/auth/logout', { method: 'POST' }),
  metrics: () => request<AdminMetricsResponse>('/admin/metrics'),
  dailyMetrics: (days: number) => request<DailyMetricsResponse>(`/admin/metrics/daily?days=${days}`),
  notices: (page: number, size = 10) =>
    request<Page<NoticeListItem>>(`/admin/notices?page=${page}&size=${size}`),
  notice: (id: number) => request<NoticeResponse>(`/admin/notices/${id}`),
  createNotice: (body: NoticeCreateRequest) =>
    request<NoticeResponse>('/admin/notices', { method: 'POST', body }),
  updateNotice: (id: number, body: NoticeUpdateRequest) =>
    request<NoticeResponse>(`/admin/notices/${id}`, { method: 'PATCH', body }),
  deleteNotice: (id: number) => request<void>(`/admin/notices/${id}`, { method: 'DELETE' }),
  grants: (page: number, size = 10) =>
    request<Page<StreakFreezeGrant>>(`/admin/streak-freeze-grants?page=${page}&size=${size}`),
  grant: (body: StreakFreezeGrantRequest) =>
    request<StreakFreezeGrant>('/admin/streak-freeze-grants', { method: 'POST', body }),
  searchUsers: (keyword: string, page = 0, size = 10) =>
    request<Page<AdminUser>>(
      `/admin/users?keyword=${encodeURIComponent(keyword)}&page=${page}&size=${size}`,
    ),
  inquiries: (status: InquiryStatus | null, page: number, size = 10) =>
    request<Page<AdminInquiryListItem>>(
      `/admin/inquiries?${status ? `status=${status}&` : ''}page=${page}&size=${size}`,
    ),
  inquiry: (id: number) => request<AdminInquiryResponse>(`/admin/inquiries/${id}`),
  answerInquiry: (id: number, content: string) =>
    request<AdminInquiryMessage>(`/admin/inquiries/${id}/messages`, { method: 'POST', body: { content } }),
  closeInquiry: (id: number) => request<void>(`/admin/inquiries/${id}/close`, { method: 'POST' }),
  changeUserPassword: (userId: number, body: AdminPasswordChangeRequest) =>
    request<void>(`/admin/users/${userId}/password`, { method: 'PATCH', body }),
}
