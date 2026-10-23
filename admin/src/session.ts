import type { AdminSummary } from './types'

// 로그인한 관리자와 액세스 토큰(8.1). 재발급이 없어 만료(9시간)되면 다시 로그인한다.
const KEY = 'hangguet-admin-session'

export type AdminSession = { accessToken: string; admin: AdminSummary }

export function loadSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as AdminSession) : null
  } catch {
    return null
  }
}

export function saveSession(session: AdminSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // 저장하지 못하면 이 탭에서만 로그인 상태가 유지된다
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 지우지 못해도 다음 요청이 401이면 로그인 화면으로 간다
  }
}
