import { type ReactNode, useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { InquiryStatusChip } from '../components/InquiryStatusChip'
import { dotDate, inquirer } from '../format'
import { navigate } from '../route'
import type { AdminInquiryListItem, InquiryStatus, Page } from '../types'

// 열 너비(문의번호 · 제목 · 문의한 사람 · 상태 · 작성일). Figma A04 문의 목록
const WIDTHS = [88, 400, 300, 120, 120]
const HEADS = ['문의번호', '제목', '문의한 사람', '상태', '작성일']
const FILTERS: { label: string; status: InquiryStatus | null }[] = [
  { label: '전체', status: null },
  { label: '답변 대기', status: 'WAITING' },
  { label: '답변함', status: 'ANSWERED' },
  { label: '종료', status: 'CLOSED' },
]

// A04 문의 목록(9.6). 최근 작성순, 상태 필터(전체면 status를 보내지 않음). 줄을 누르면 A04-1
export function InquiryListPage() {
  const [status, setStatus] = useState<InquiryStatus | null>(null)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<AdminInquiryListItem> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api
      .inquiries(status, page)
      .then((d) => {
        if (!active) return
        setData(d)
        setError(null)
      })
      .catch((e) => active && setError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.'))
    return () => {
      active = false
    }
  }, [status, page])

  const choose = (next: InquiryStatus | null) => {
    setStatus(next)
    setPage(0)
  }

  const totalPages = Math.max(1, data?.page.totalPages ?? 1)

  return (
    <>
      <div className="page-title">
        <h1>문의</h1>
      </div>
      <div className="filters" role="group" aria-label="상태 필터">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className="filter"
            aria-pressed={status === f.status}
            onClick={() => choose(f.status)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="table">
        <Row cells={HEADS} head />
        {data?.content.map((q) => (
          <Row
            key={q.id}
            label={`${q.title} 문의 열기`}
            onOpen={() => navigate({ name: 'inquiry', id: q.id })}
            cells={[
              <span key="id" style={{ color: 'var(--text-3)' }}>
                {q.id}
              </span>,
              <strong
                key="t"
                style={{ fontWeight: 600, fontSize: 16, color: q.status === 'CLOSED' ? 'var(--text-3)' : 'var(--text-1)' }}
              >
                {q.title}
              </strong>,
              inquirer(q),
              <InquiryStatusChip key="s" status={q.status} />,
              <span key="c" style={{ color: 'var(--text-3)' }}>
                {dotDate(q.createdAt)}
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

// 줄 전체를 누르면 A04-1(키보드는 Enter · Space)
function Row({ cells, head = false, label, onOpen }: { cells: ReactNode[]; head?: boolean; label?: string; onOpen?: () => void }) {
  return (
    <div
      className={`table-row${head ? ' table-head' : ''}`}
      style={{ gap: 16, cursor: onOpen ? 'pointer' : undefined }}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      {cells.map((cell, i) => (
        <div
          key={i}
          style={{ width: WIDTHS[i], flexShrink: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {cell}
        </div>
      ))}
    </div>
  )
}
