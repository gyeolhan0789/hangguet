import { type FormEvent, useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { fromLocalInput, toLocalInput } from '../format'
import { navigate } from '../route'
import type { NoticeResponse, NoticeUpdateRequest } from '../types'

const FIELD_KEYS = { title: true, content: true, startsAt: true, endsAt: true }
type Errors = Partial<Record<keyof typeof FIELD_KEYS, string>>
const TITLE_MAX = 100

/**
 * A02-1 공지 작성(8.4) · 수정(8.5로 채우고 8.6은 바뀐 필드만). 서버와 같은 규칙을 화면에서도 먼저 검사한다: 제목 1~100자 · 내용 필수 ·
 * 게시 시작 필수, 게시 종료는 비우면('종료 없이 계속') 계속 보여 준다. 없는 공지(404)면 A02로.
 */
export function NoticeFormPage({ noticeId }: { noticeId?: number }) {
  const editing = noticeId !== undefined
  const [original, setOriginal] = useState<NoticeResponse | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [noEnd, setNoEnd] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // 수정: 8.5로 칸을 채운다
  useEffect(() => {
    if (noticeId === undefined) return
    let active = true
    api
      .notice(noticeId)
      .then((n) => {
        if (!active) return
        setOriginal(n)
        setTitle(n.title)
        setContent(n.content)
        setStartsAt(toLocalInput(n.startsAt))
        setEndsAt(n.endsAt ? toLocalInput(n.endsAt) : '')
        setNoEnd(n.endsAt === null)
      })
      .catch((e) => {
        if (!active) return
        if (e instanceof ApiError && e.problem.code === 'NOTICE_NOT_FOUND') navigate('notices')
        else setServerError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.')
      })
    return () => {
      active = false
    }
  }, [noticeId])

  // 서버와 같은 문구: 작성(8.4 NoticeCreateRequest) · 수정(8.6 NoticeUpdateRequest)
  const validate = (): Errors => {
    const next: Errors = {}
    if (editing) {
      if (!title || title.length > TITLE_MAX) next.title = '1~100자입니다.'
      else if (!title.trim()) next.title = '공백만으로는 바꿀 수 없습니다.'
      if (!content.trim()) next.content = '공백만으로는 바꿀 수 없습니다.'
    } else {
      if (!title.trim()) next.title = '필수 값입니다.'
      else if (title.length > TITLE_MAX) next.title = '최대 100자입니다.'
      if (!content.trim()) next.content = '필수 값입니다.'
    }
    if (!startsAt) next.startsAt = '필수 값입니다.'
    return next
  }

  const endsAtValue = noEnd || !endsAt ? null : fromLocalInput(endsAt)

  // 수정은 바뀐 필드만 보낸다. 종료를 비우면 endsAt: null
  const changes = (n: NoticeResponse): NoticeUpdateRequest => {
    const body: NoticeUpdateRequest = {}
    if (title !== n.title) body.title = title
    if (content !== n.content) body.content = content
    if (fromLocalInput(startsAt) !== `${toLocalInput(n.startsAt)}:00+09:00`) body.startsAt = fromLocalInput(startsAt)
    const before = n.endsAt === null ? null : `${toLocalInput(n.endsAt)}:00+09:00`
    if (endsAtValue !== before) body.endsAt = endsAtValue
    return body
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const next = validate()
    setErrors(next)
    setServerError(null)
    if (Object.keys(next).length > 0) return
    setPending(true)
    try {
      if (editing) {
        if (!original) return
        await api.updateNotice(original.id, changes(original))
      } else {
        await api.createNotice({ title, content, startsAt: fromLocalInput(startsAt), endsAt: endsAtValue })
      }
      navigate('notices')
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'NOTICE_NOT_FOUND') {
        navigate('notices')
        return
      }
      // 화면에 있는 칸의 오류는 그 칸 아래에, 그 밖의 실패는 버튼 아래에 서버 문구로 보여 준다
      const onForm = e instanceof ApiError ? (e.problem.errors ?? []).filter((f) => f.field in FIELD_KEYS) : []
      if (onForm.length > 0) setErrors(Object.fromEntries(onForm.map((f) => [f.field, f.reason])))
      else setServerError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.')
    } finally {
      setPending(false)
    }
  }

  // 수정: 8.5로 칸을 채우기 전에는 입력을 막는다(응답이 오면 덮어쓰므로)
  const loading = editing && !original

  return (
    <form onSubmit={submit} style={{ width: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <button
          type="button"
          onClick={() => navigate('notices')}
          style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-3)' }}
        >
          ‹ 공지 목록
        </button>
        <h1 style={{ margin: '4px 0 0', fontSize: 32, fontWeight: 700 }}>{editing ? '공지 수정' : '공지 작성'}</h1>
      </div>

      <div className="field">
        <label htmlFor="title">제목</label>
        <input
          id="title"
          disabled={loading}
          className="input"
          placeholder="예) 10월 점검 안내"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className="help" style={{ textAlign: 'right' }}>
          {title.length} / {TITLE_MAX}
        </span>
        {errors.title && <p className="error">{errors.title}</p>}
      </div>

      <div className="field">
        <label htmlFor="content">내용</label>
        <textarea
          id="content"
          disabled={loading}
          className="input"
          placeholder="사용자에게 보여 줄 공지 내용을 적어 주세요"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{ height: 200, padding: '14px 16px', resize: 'vertical' }}
        />
        {errors.content && <p className="error">{errors.content}</p>}
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="startsAt">게시 시작</label>
          <input
            id="startsAt"
            disabled={loading}
            className="input"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          {errors.startsAt && <p className="error">{errors.startsAt}</p>}
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="endsAt">게시 종료</label>
          <input
            id="endsAt"
            className="input"
            type="datetime-local"
            value={endsAt}
            disabled={noEnd || loading}
            onChange={(e) => setEndsAt(e.target.value)}
          />
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 14, color: 'var(--text-2)', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={noEnd}
              disabled={loading}
              onChange={(e) => setNoEnd(e.target.checked)}
              style={{ accentColor: 'var(--text-1)', width: 18, height: 18, margin: 0 }}
            />
            종료 없이 계속 보여 주기
          </label>
          {errors.endsAt && <p className="error">{errors.endsAt}</p>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn" style={{ width: 96 }} onClick={() => navigate('notices')}>
          취소
        </button>
        <button type="submit" className="btn btn-primary" style={{ width: 96 }} disabled={pending || loading}>
          저장
        </button>
      </div>
      {serverError && (
        <p className="error" role="alert" style={{ textAlign: 'right' }}>
          {serverError}
        </p>
      )}
    </form>
  )
}
