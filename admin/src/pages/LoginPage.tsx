import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../api'
import { Brand } from '../components/Header'
import type { AdminSession } from '../session'

type Props = { onLogin: (session: AdminSession) => void }

// A01 관리자 로그인. 회원가입 · 비밀번호 찾기 없음
export function LoginPage({ onLogin }: Props) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    // 서버(8.1 AdminLoginRequest)와 같은 규칙 · 문구: 필수, 아이디 50자 · 비밀번호 64자 이하
    if (!loginId.trim() || !password.trim()) {
      setError('필수 값입니다.')
      return
    }
    if (loginId.length > 50) {
      setError('최대 50자입니다.')
      return
    }
    if (password.length > 64) {
      setError('최대 64자입니다.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await api.login(loginId, password)
      onLogin({ accessToken: res.accessToken, admin: res.admin })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 440 }}>
        <form className="card" style={{ padding: 40 }} onSubmit={submit}>
          <Brand name="한끗 백오피스" small />
          <h1 style={{ margin: '20px 0 4px', fontSize: 24, fontWeight: 700 }}>관리자 로그인</h1>
          <p className="help" style={{ fontSize: 14, marginBottom: 24 }}>
            운영자 계정으로 로그인해 주세요
          </p>
          <div className="field" style={{ marginBottom: 20 }}>
            <label htmlFor="loginId">아이디</label>
            <input
              id="loginId"
              className="input"
              autoComplete="username"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 24 }}>
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-wide" disabled={pending}>
            로그인
          </button>
        </form>
        {error && (
          <p className="error" role="alert" style={{ marginTop: 16, textAlign: 'center' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
