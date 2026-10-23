import { type ReactNode, useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { dotDate, monthDay } from '../format'
import { navigate } from '../route'
import type { Page, StreakFreezeGrant } from '../types'

// 열 너비(지급일 · 메울 날짜 · 대상 · 개수 · 사유 · 상태 · 등록). 사유가 남은 너비를 쓴다
const WIDTHS = [120, 120, 150, 60, 0, 100, 120]
const HEADS = ['지급일', '메울 날짜', '대상', '개수', '사유', '상태', '등록']

// A03 스트릭 유지권 배포 목록(8.10). 최근 등록순, 배포는 취소 · 수정할 수 없어 줄에 버튼이 없다
export function GrantListPage() {
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<StreakFreezeGrant> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api
      .grants(page)
      .then((d) => {
        if (!active) return
        setData(d)
        setError(null)
      })
      .catch((e) => active && setError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.'))
    return () => {
      active = false
    }
  }, [page])

  const totalPages = Math.max(1, data?.page.totalPages ?? 1)

  return (
    <>
      <div className="page-title">
        <h1>스트릭 유지권 배포</h1>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('grant-new')}>
            + 유지권 배포
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table">
        <Row cells={HEADS} head />
        {data?.content.map((g) => (
          <Row
            key={g.id}
            cells={[
              <strong key="d" style={{ fontWeight: 500, color: 'var(--text-1)' }}>
                {dotDate(g.grantDate)}
              </strong>,
              <strong key="f" style={{ fontWeight: 500, color: 'var(--text-1)' }}>
                {dotDate(g.fillableDate)}
              </strong>,
              `${g.targetType === 'ALL' ? '전체 회원' : '지정 회원'} ${g.targetCount}명`,
              `${g.quantity}개`,
              g.reason ?? '',
              <span
                key="s"
                className={`status ${g.status === 'SCHEDULED' ? 'status-scheduled' : 'status-granted'}`}
              >
                {g.status === 'SCHEDULED' ? '지급 전' : '지급함'}
              </span>,
              <span key="c" style={{ color: 'var(--text-3)' }}>
                {monthDay(g.createdAt)} · {g.adminName}
              </span>,
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
    </>
  )
}

function Row({ cells, head = false }: { cells: ReactNode[]; head?: boolean }) {
  return (
    <div className={`table-row${head ? ' table-head' : ''}`}>
      {cells.map((cell, i) => (
        <div key={i} style={WIDTHS[i] ? { width: WIDTHS[i], flexShrink: 0 } : { flex: 1, minWidth: 0 }}>
          {cell}
        </div>
      ))}
    </div>
  )
}
