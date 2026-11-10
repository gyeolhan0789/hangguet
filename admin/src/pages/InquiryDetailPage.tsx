import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { navigate } from '../route'
import type { AdminInquiryResponse, AdminUser, InquiryAttachment } from '../types'
import { InquiryStatusChip } from '../components/InquiryStatusChip'

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/
const PASSWORD_MESSAGE = '8~64자, 영문과 숫자를 모두 포함해야 합니다.'
const RETRY = '잠시 후 다시 시도해 주세요.'

/** 2026-10-26T10:00:00+09:00 → 10.26 10:00 */
const stamp = (dateTime: string) => `${dateTime.slice(5, 10).replace('-', '.')} ${dateTime.slice(11, 16)}`

/**
 * A04-1 문의 상세(9.7). 메시지는 오래된 순: 문의한 사람 왼쪽, 관리자 답변 오른쪽 + 답변한 관리자 이름.
 * 붙인 사진은 말풍선 아래에 두고, 누르면 원본을 새 탭에서 연다(사용자 화면 I03과 같음).
 * [답변 보내기] 9.8 → 상태 답변함. 종료한 문의면 답변칸 · [문의 종료]가 없다(409 INQUIRY_CLOSED).
 * [비밀번호 변경] → A04-2, [문의 종료] → A04-3. 없는 문의(404)면 A04로.
 */
export function InquiryDetailPage({ inquiryId }: { inquiryId: number }) {
  const [inquiry, setInquiry] = useState<AdminInquiryResponse | null>(null)
  const [answer, setAnswer] = useState('')
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [modal, setModal] = useState<'password' | 'close' | null>(null)

  const load = useCallback(() => {
    return api
      .inquiry(inquiryId)
      .then((d) => {
        setInquiry(d)
        setError(null)
      })
      .catch((e) => {
        if (e instanceof ApiError && e.problem.code === 'INQUIRY_NOT_FOUND') navigate('inquiries')
        else setError(e instanceof ApiError ? e.message : RETRY)
      })
  }, [inquiryId])

  useEffect(() => {
    void load()
  }, [load])

  // 9.8은 단 답변만 돌려주므로 상태 칩까지 바꾸려고 9.7을 다시 부른다
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    if (!answer.trim()) {
      setAnswerError('필수 값입니다.')
      return
    }
    setAnswerError(null)
    setPending(true)
    try {
      await api.answerInquiry(inquiryId, answer)
      setAnswer('')
      await load()
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'INQUIRY_NOT_FOUND') {
        navigate('inquiries')
        return
      }
      const field = e instanceof ApiError ? e.problem.errors?.find((f) => f.field === 'content') : undefined
      if (field) setAnswerError(field.reason)
      else setError(e instanceof ApiError ? e.message : RETRY)
      // 다른 관리자 · 문의한 사람이 먼저 종료했으면(409) 종료 상태로 다시 그린다
      if (e instanceof ApiError && e.problem.code === 'INQUIRY_CLOSED') await load()
    } finally {
      setPending(false)
    }
  }

  if (!inquiry) {
    return error ? <p className="error">{error}</p> : null
  }

  const closed = inquiry.status === 'CLOSED'
  const who = inquiry.userId === null ? `비회원 · ${inquiry.email}` : `${inquiry.nickname} · ${inquiry.email}`

  return (
    <div style={{ width: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <button
            type="button"
            onClick={() => navigate('inquiries')}
            style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-3)' }}
          >
            ‹ 문의 목록
          </button>
          <h1 style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 700, overflowWrap: 'anywhere' }}>{inquiry.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 14, fontWeight: 500 }}>
            <span style={{ color: 'var(--text-3)' }}>문의번호 {inquiry.id}</span>
            <InquiryStatusChip status={inquiry.status} />
            <span style={{ color: 'var(--text-2)' }}>{who}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button type="button" className="btn" style={{ width: 120, height: 40, padding: 0, fontSize: 14 }} onClick={() => setModal('password')}>
            비밀번호 변경
          </button>
          {!closed && (
            <button type="button" className="btn" style={{ width: 96, height: 40, padding: 0, fontSize: 14 }} onClick={() => setModal('close')}>
              문의 종료
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {inquiry.messages.map((m) => {
          const mine = m.authorType === 'ADMIN'
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>{mine ? m.adminName : '문의한 사람'}</span>
              <p
                style={{
                  margin: 0,
                  maxWidth: 480,
                  padding: '14px 18px',
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  background: 'var(--surface)',
                  fontSize: 15,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {m.content}
              </p>
              <MessagePhotos attachments={m.attachments} />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{stamp(m.createdAt)}</span>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!closed && (
        <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="field">
            <label htmlFor="answer">답변</label>
            <textarea
              id="answer"
              className="input"
              placeholder="답변을 적어 주세요"
              maxLength={2000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              style={{ height: 140, padding: '14px 16px', resize: 'vertical' }}
            />
            {answerError && <p className="error">{answerError}</p>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" style={{ width: 120, padding: 0 }} disabled={pending}>
              답변 보내기
            </button>
          </div>
        </form>
      )}

      {modal === 'password' && <PasswordModal inquiry={inquiry} onClose={() => setModal(null)} />}
      {modal === 'close' && (
        <CloseModal
          inquiryId={inquiry.id}
          onClose={() => setModal(null)}
          onClosed={async () => {
            setModal(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function MessagePhotos({ attachments }: { attachments: InquiryAttachment[] }) {
  if (attachments.length === 0) return null
  return (
    <ul aria-label="붙인 사진" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 480, margin: 0, padding: 0, listStyle: 'none' }}>
      {attachments.map((photo, index) => (
        <li key={photo.id}>
          <a
            href={photo.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`붙인 사진 ${index + 1} 원본 보기(새 탭)`}
            style={{
              display: 'block',
              width: 96,
              height: 96,
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: `var(--surface) center / cover no-repeat url("${photo.url}")`,
            }}
          />
        </li>
      ))}
    </ul>
  )
}

/** Esc로 닫는다. 요청 중에는 닫지 않는다 */
function useEscape(onClose: () => void, pending: boolean) {
  useEffect(() => {
    if (pending) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending])
}

/** A04-3 문의 종료 확인. [종료] 9.9(204) → A04-1(종료 상태) · [취소] · Esc → 닫기 */
function CloseModal({ inquiryId, onClose, onClosed }: { inquiryId: number; onClose: () => void; onClosed: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEscape(onClose, pending)

  const close = async () => {
    if (pending) return
    setPending(true)
    try {
      await api.closeInquiry(inquiryId)
      onClosed()
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'INQUIRY_NOT_FOUND') navigate('inquiries')
      else setError(e instanceof ApiError ? e.message : RETRY)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="dim">
      <div className="modal modal-stack" role="dialog" aria-modal="true" aria-labelledby="inquiry-close-title">
        <h2 id="inquiry-close-title">문의를 종료할까요?</h2>
        <p>종료하면 이 문의에는 더 쓸 수 없어요</p>
        {error && <p className="error">{error}</p>}
        {/* Figma A04-3: 본문과 버튼 사이 Spacer 12(간격 12 + 12 + 12) */}
        <div className="modal-buttons" style={{ marginTop: 24 }}>
          <button type="button" className="btn" autoFocus disabled={pending} onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={close}>
            종료
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * A04-2 회원 비밀번호 변경(9.10). 회원 문의면 문의한 회원으로 채워 두고, 비회원 문의면 8.12 회원 검색으로 1명 고른다(✕로 빼기).
 * 새 비밀번호는 2.3과 같은 규칙. [변경] → 204면 닫고 A04-1. 없는 회원 · 없는 문의(404)는 모달 안 서버 문구.
 */
function PasswordModal({ inquiry, onClose }: { inquiry: AdminInquiryResponse; onClose: () => void }) {
  const initial: AdminUser | null =
    inquiry.userId === null || inquiry.nickname === null
      ? null
      : { id: inquiry.userId, nickname: inquiry.nickname, email: inquiry.email, createdAt: inquiry.createdAt }
  const [target, setTarget] = useState<AdminUser | null>(initial)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<AdminUser[]>([])
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ user?: string; newPassword?: string }>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEscape(onClose, pending)

  // 8.12 회원 검색. 입력을 멈추고 0.3초 뒤에 찾는다(A03-1과 같음)
  useEffect(() => {
    const trimmed = keyword.trim()
    if (trimmed.length === 0 || trimmed.length > 255) return
    let active = true
    const timer = setTimeout(() => {
      api
        .searchUsers(trimmed)
        .then((page) => active && setResults(page.content))
        .catch(() => active && setResults([]))
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [keyword])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const next: typeof errors = {}
    if (!target) next.user = '필수 값입니다.'
    if (password.length < 8 || password.length > 64 || !PASSWORD_RULE.test(password)) next.newPassword = PASSWORD_MESSAGE
    setErrors(next)
    setServerError(null)
    if (!target || Object.keys(next).length > 0) return
    setPending(true)
    try {
      await api.changeUserPassword(target.id, { newPassword: password, inquiryId: inquiry.id })
      onClose()
    } catch (e) {
      const field = e instanceof ApiError ? e.problem.errors?.find((f) => f.field === 'newPassword') : undefined
      if (field) setErrors({ newPassword: field.reason })
      else setServerError(e instanceof ApiError ? e.message : RETRY)
    } finally {
      setPending(false)
    }
  }

  const visibleResults = keyword.trim() ? results : []

  return (
    <div className="dim">
      <form
        onSubmit={submit}
        className="modal modal-stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
        style={{ width: 480 }}
      >
        <h2 id="password-title">회원 비밀번호 변경</h2>
        <p>문의번호 {inquiry.id} 요청으로 바꿔요</p>

        {/* Figma A04-2: 부제 아래 Spacer 4 · 검색 칸 아래에 고른 회원(✕로 빼기) · 그 아래 안내 */}
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="user-search">대상 회원</label>
          <input
            id="user-search"
            className="input"
            placeholder="이메일 또는 닉네임으로 검색"
            value={keyword}
            maxLength={255}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {visibleResults.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 0', maxHeight: 200, overflowY: 'auto' }}>
              {visibleResults.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setTarget(u)
                    setKeyword('')
                  }}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 12, padding: '10px 16px', border: 0, background: 'none', textAlign: 'left' }}
                >
                  <span style={{ width: 130, fontSize: 15, fontWeight: 600 }}>{u.nickname}</span>
                  <span style={{ fontSize: 14, color: 'var(--text-3)' }}>{u.email}</span>
                </button>
              ))}
            </div>
          )}
          {errors.user && <p className="error">{errors.user}</p>}
        </div>
        {target && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderRadius: 8, background: 'var(--bg)' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {target.nickname} · {target.email}
            </span>
            <button
              type="button"
              onClick={() => setTarget(null)}
              aria-label={`${target.nickname} 빼기`}
              style={{ border: 0, background: 'none', padding: 0, fontSize: 15, color: 'var(--text-3)' }}
            >
              ✕
            </button>
          </div>
        )}
        <p className="help">회원 문의면 문의한 회원으로 채워져 있어요</p>

        <div className="field">
          <label htmlFor="new-password">새 비밀번호</label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="8~64자, 영문·숫자 각 1자 이상"
            value={password}
            maxLength={64}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="help">바꾸면 이 회원은 모든 기기에서 로그아웃돼요</p>
          {errors.newPassword && <p className="error">{errors.newPassword}</p>}
        </div>

        {serverError && (
          <p className="error" role="alert">
            {serverError}
          </p>
        )}
        {/* Figma A04-2: 버튼 위 Spacer 8(간격 12 + 8 + 12) */}
        <div className="modal-buttons" style={{ marginTop: 20 }}>
          <button type="button" className="btn" disabled={pending} onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            변경
          </button>
        </div>
      </form>
    </div>
  )
}

