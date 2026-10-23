import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { dotDate, period } from '../format'
import { navigate } from '../route'
import type { NoticeListItem, Page } from '../types'

// 열 너비(제목 · 게시 기간 · 작성일 · 버튼). Figma A02 공지 목록
const WIDTHS = [440, 300, 140, 176]
const HEADS = ['제목', '게시 기간', '작성일', '']

// A02 공지 목록(8.3) · A02-2 공지 삭제 확인(8.7). 최근 작성순, 본문은 목록에 없다
export function NoticeListPage() {
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<NoticeListItem> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<NoticeListItem | null>(null)
  const [pending, setPending] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    api
      .notices(page)
      .then((d) => {
        if (!active) return
        // 마지막 페이지의 마지막 공지를 지워 빈 페이지가 되면 앞 페이지로 옮긴다
        if (d.content.length === 0 && page > 0) {
          setPage(Math.max(0, d.page.totalPages - 1))
          return
        }
        setData(d)
        setError(null)
      })
      .catch((e) => active && setError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.'))
    return () => {
      active = false
    }
  }, [page, reload])

  const closeModal = useCallback(() => setDeleting(null), [])

  // [취소] · Esc → 닫기. 삭제 요청 중에는 닫지 않는다
  useEffect(() => {
    if (!deleting || pending) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeModal()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleting, pending, closeModal])

  // 삭제했거나 이미 없는 공지(404 NOTICE_NOT_FOUND)면 목록을 다시 불러온다
  const remove = async () => {
    if (!deleting) return
    if (pending) return
    setPending(true)
    try {
      await api.deleteNotice(deleting.id)
      setReload((n) => n + 1)
    } catch (e) {
      if (e instanceof ApiError && e.problem.code === 'NOTICE_NOT_FOUND') setReload((n) => n + 1)
      else setError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.')
    } finally {
      setPending(false)
      setDeleting(null)
    }
  }

  const totalPages = Math.max(1, data?.page.totalPages ?? 1)

  return (
    <>
      <div className="page-title">
        <h1>공지</h1>
        <div className="actions">
          <button type="button" className="btn btn-primary" style={{ width: 136 }} onClick={() => navigate('notice-new')}>
            + 공지 작성
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table">
        <Row cells={HEADS} head />
        {data?.content.map((n) => (
          <Row
            key={n.id}
            cells={[
              <strong key="t" style={{ fontWeight: 600, fontSize: 16, color: 'var(--text-1)' }}>
                {n.title}
              </strong>,
              period(n.startsAt, n.endsAt),
              <span key="c" style={{ color: 'var(--text-3)' }}>
                {dotDate(n.createdAt)}
              </span>,
              <div key="a" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => navigate({ name: 'notice-edit', id: n.id })}
                  aria-label={`${n.title} 수정`}
                >
                  수정
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setDeleting(n)}
                  aria-label={`${n.title} 삭제`}
                >
                  삭제
                </button>
              </div>,
            ]}
          />
        ))}
      </div>
      <div className="pager">
        <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="이전 페이지">
          ‹
        </button>
        <span>
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page + 1 >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          aria-label="다음 페이지"
        >
          ›
        </button>
      </div>

      {deleting && (
        <div className="dim">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="notice-delete-title">
            <h2 id="notice-delete-title">공지를 삭제할까요?</h2>
            {/* Figma A02-2: 본문 아래에서 버튼까지 36 */}
            <p style={{ marginBottom: 16 }}>{`'${deleting.title}'가 사용자 화면에서 사라져요`}</p>
            <div className="modal-buttons">
              <button type="button" className="btn" autoFocus disabled={pending} onClick={closeModal}>
                취소
              </button>
              <button type="button" className="btn btn-primary" disabled={pending} onClick={remove}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Row({ cells, head = false }: { cells: ReactNode[]; head?: boolean }) {
  return (
    <div className={`table-row${head ? ' table-head' : ''}`} style={{ gap: 16 }}>
      {cells.map((cell, i) => (
        <div key={i} style={{ width: WIDTHS[i], flexShrink: 0, minWidth: 0 }}>
          {cell}
        </div>
      ))}
    </div>
  )
}
