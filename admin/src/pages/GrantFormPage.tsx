import { type FormEvent, useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { monthDay } from '../format'
import { navigate } from '../route'
import type { AdminUser, GrantTarget, StreakFreezeGrantRequest } from '../types'

const FIELD_KEYS = { userIds: true, quantity: true, grantDate: true, fillableDate: true, reason: true }
type Errors = Partial<Record<keyof typeof FIELD_KEYS, string>>

// A03-1 스트릭 유지권 배포 · A03-2 배포 확인. 서버(8.11)와 같은 규칙을 화면에서도 먼저 검사한다
export function GrantFormPage() {
  const [targetType, setTargetType] = useState<GrantTarget>('ALL')
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<AdminUser[]>([])
  const [chosen, setChosen] = useState<AdminUser[]>([])
  const [quantity, setQuantity] = useState('1')
  const [grantDate, setGrantDate] = useState('')
  const [fillableDate, setFillableDate] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)

  // 8.12 회원 검색. 입력을 멈추고 0.3초 뒤에 찾는다
  useEffect(() => {
    const trimmed = keyword.trim()
    if (targetType !== 'USERS' || trimmed.length === 0 || trimmed.length > 255) {
      return
    }
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
  }, [keyword, targetType])

  // Esc → A03-1로. 배포 요청 중에는 닫지 않는다
  useEffect(() => {
    if (!confirming || pending) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setConfirming(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming, pending])

  const toggle = (user: AdminUser) =>
    setChosen((prev) => (prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]))

  const validate = (): Errors => {
    const next: Errors = {}
    if (targetType === 'USERS' && chosen.length === 0) next.userIds = '배포 대상이 USERS면 1명 이상입니다.'
    if (!/^\d+$/.test(quantity) || Number(quantity) < 1) next.quantity = '1 이상입니다.'
    if (!grantDate) next.grantDate = '필수 값입니다.'
    if (!fillableDate) next.fillableDate = '필수 값입니다.'
    if (reason.trim().length > 255) next.reason = '최대 255자입니다.'
    return next
  }

  const openConfirm = (event: FormEvent) => {
    event.preventDefault()
    const next = validate()
    setErrors(next)
    setServerError(null)
    if (Object.keys(next).length === 0) setConfirming(true)
  }

  const submit = async () => {
    const body: StreakFreezeGrantRequest = {
      targetType,
      userIds: targetType === 'USERS' ? chosen.map((u) => u.id) : null,
      quantity: Number(quantity),
      grantDate,
      fillableDate,
      reason: reason.trim() === '' ? null : reason.trim(),
    }
    setPending(true)
    try {
      await api.grant(body)
      navigate('grants')
    } catch (e) {
      setConfirming(false)
      // 화면에 있는 칸의 오류는 그 칸 아래에, 그 밖의 실패는 버튼 아래에 서버 문구로 보여 준다
      const onForm = e instanceof ApiError ? (e.problem.errors ?? []).filter((f) => f.field in FIELD_KEYS) : []
      if (onForm.length > 0) {
        setErrors(Object.fromEntries(onForm.map((f) => [f.field, f.reason])))
      } else {
        setServerError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.')
      }
    } finally {
      setPending(false)
    }
  }

  // 검색어를 지우면 지난 결과를 보이지 않는다
  const visibleResults = keyword.trim() ? results : []

  const count = Number(quantity)
  const targetText =
    targetType === 'ALL' ? `전체 회원에게 ${count}개씩` : `지정 회원 ${chosen.length}명에게 ${count}개씩`

  return (
    <form onSubmit={openConfirm} style={{ width: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <button
          type="button"
          onClick={() => navigate('grants')}
          style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-3)' }}
        >
          ‹ 배포 목록
        </button>
        <h1 style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 700 }}>유지권 배포</h1>
      </div>

      <fieldset className="field" style={{ gap: 10, border: 0, margin: 0, padding: 0 }}>
        <legend className="field-label" style={{ padding: 0, marginBottom: 10 }}>
          대상
        </legend>
        <div style={{ display: 'flex', gap: 24 }} role="radiogroup" aria-label="대상">
          {(['ALL', 'USERS'] as const).map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, cursor: 'pointer' }}>
              <input
                type="radio"
                name="targetType"
                checked={targetType === t}
                onChange={() => setTargetType(t)}
                style={{ accentColor: 'var(--text-1)', width: 18, height: 18, margin: 0 }}
              />
              <span style={{ fontWeight: targetType === t ? 600 : 400, color: targetType === t ? 'var(--text-1)' : 'var(--text-2)' }}>
                {t === 'ALL' ? '전체 회원' : '지정 회원'}
              </span>
            </label>
          ))}
        </div>
        {targetType === 'USERS' && (
          <>
            {/* Figma A03-1: 검색칸 오른쪽 돋보기 18 */}
            <div style={{ position: 'relative' }}>
              <input
                className="input"
                value={keyword}
                maxLength={255}
                onChange={(e) => setKeyword(e.target.value)}
                aria-label="회원 검색"
                style={{ width: '100%', paddingRight: 44 }}
              />
              <svg
                aria-hidden
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                style={{ position: 'absolute', right: 16, top: 15 }}
              >
                <circle cx="11" cy="11" r="7" stroke="#8a8a8a" strokeWidth="2" />
                <path d="M20 20l-3.5-3.5" stroke="#8a8a8a" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            {visibleResults.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 0' }}>
                {visibleResults.map((u) => (
                  <label
                    key={u.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.some((c) => c.id === u.id)}
                      onChange={() => toggle(u)}
                      style={{ accentColor: 'var(--text-1)', width: 18, height: 18, margin: 0 }}
                    />
                    <span style={{ width: 130, fontSize: 15, fontWeight: 600 }}>{u.nickname}</span>
                    <span style={{ fontSize: 14, color: 'var(--text-3)' }}>{u.email}</span>
                  </label>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>고른 회원 {chosen.length}명</span>
              {chosen.map((u) => (
                <span
                  key={u.id}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 12px', borderRadius: 999, background: 'var(--chip)', fontSize: 13, fontWeight: 600 }}
                >
                  {u.nickname}
                  <button
                    type="button"
                    onClick={() => toggle(u)}
                    aria-label={`${u.nickname} 빼기`}
                    style={{ border: 0, background: 'none', padding: 0, fontSize: 12, color: 'var(--text-3)' }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
        {errors.userIds && <p className="error">{errors.userIds}</p>}
      </fieldset>

      <div className="field">
        <label htmlFor="quantity">지급 개수</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="quantity"
            className="input"
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={{ width: 160 }}
          />
          <span style={{ fontSize: 14, color: 'var(--text-2)' }}>개 (한 사람에게)</span>
        </div>
        {errors.quantity && <p className="error">{errors.quantity}</p>}
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="grantDate">지급 날짜</label>
          <input id="grantDate" className="input" type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)} />
          <p className="help">이 날짜부터 2주 동안 쓸 수 있어요</p>
          {errors.grantDate && <p className="error">{errors.grantDate}</p>}
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="fillableDate">메울 수 있는 날짜</label>
          <input
            id="fillableDate"
            className="input"
            type="date"
            value={fillableDate}
            onChange={(e) => setFillableDate(e.target.value)}
          />
          <p className="help">받은 회원은 이 날짜만 메울 수 있어요</p>
          {errors.fillableDate && <p className="error">{errors.fillableDate}</p>}
        </div>
      </div>

      <div className="field">
        <label htmlFor="reason">사유 (선택)</label>
        <input
          id="reason"
          className="input"
          placeholder="예) 10월 30일 점검 보상"
          maxLength={255}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {errors.reason && <p className="error">{errors.reason}</p>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn" style={{ width: 96 }} onClick={() => navigate('grants')}>
          취소
        </button>
        <button type="submit" className="btn btn-primary" style={{ width: 112 }}>
          배포하기
        </button>
      </div>
      {serverError && (
        <p className="error" role="alert" style={{ textAlign: 'right' }}>
          {serverError}
        </p>
      )}

      {confirming && (
        <div className="dim">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="grant-confirm-title">
            <h2 id="grant-confirm-title">유지권을 배포할까요?</h2>
            <p>{`${targetText}\n${monthDay(grantDate)} 지급 · 메울 날짜 ${monthDay(fillableDate)}`}</p>
            <p className="notice">배포한 뒤에는 취소할 수 없어요</p>
            <div className="modal-buttons">
              <button type="button" className="btn" autoFocus disabled={pending} onClick={() => setConfirming(false)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
                배포하기
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}
