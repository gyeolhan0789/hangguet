import { useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { CoreKpi } from '../components/CoreKpi'
import { dotDate, monthDay, percent } from '../format'
import type { DailyMetric, DailyMetricsResponse } from '../types'

const PERIODS = [7, 30, 90]
// 열(이름 · 너비 · 값). Figma A05 날짜별 기록
const COLUMNS: { head: string; width: number; cell: (d: DailyMetric) => string }[] = [
  { head: '날짜', width: 86, cell: (d) => monthDay(d.date) },
  { head: '전체 회원', width: 84, cell: (d) => `${d.usersTotal}명` },
  { head: '가입 · 탈퇴', width: 92, cell: (d) => `+${d.usersJoined} · -${d.usersWithdrawn}` },
  { head: '연습', width: 70, cell: (d) => `${d.practicedUsers}명` },
  { head: '주간 연습', width: 84, cell: (d) => `${d.practicedWeek}명` },
  { head: 'D1', width: 112, cell: (d) => ratio(d.d1Returned, d.d1Eligible) },
  { head: 'D3', width: 112, cell: (d) => ratio(d.d3Returned, d.d3Eligible) },
  { head: 'D7', width: 112, cell: (d) => ratio(d.d7Returned, d.d7Eligible) },
  { head: '첫 면접 전환율', width: 128, cell: (d) => ratio(d.usersInterviewed, d.usersTotal) },
  { head: '면접', width: 72, cell: (d) => `${d.interviewsTotal}회` },
  { head: '문의 대기', width: 72, cell: (d) => `${d.inquiriesWaiting}건` },
  { head: '분석 멈춤', width: 72, cell: (d) => `${d.interviewsStuck}회` },
]

/** 37% (46/124). 분모가 0이면 '-' */
function ratio(count: number, total: number) {
  return total === 0 ? '-' : `${percent(count, total)} (${count}/${total})`
}

// A05 메트릭 히스토리. 8.16 관리자 일별 메트릭(매일 0시에 남긴 전날 기록)으로 그린다
export function HistoryPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<DailyMetricsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api
      .dailyMetrics(days)
      .then((d) => {
        if (!active) return
        setData(d)
        setError(null)
      })
      .catch((e) => {
        if (!active) return
        setData(null)
        setError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.')
      })
    return () => {
      active = false
    }
  }, [days])

  // 기간을 바꾸면 이전 기간 기록은 지운다(선택한 기간과 화면이 어긋나지 않게)
  const choose = (next: number) => {
    if (next === days) return
    setDays(next)
    setData(null)
    setError(null)
  }

  const content = data?.content ?? []
  const last = content.at(-1)
  const empty = data !== null && content.length === 0

  return (
    <>
      <div className="page-title page-title-home">
        <div>
          <h1>메트릭 히스토리</h1>
          <p className="sub">
            매일 0시에 남긴 전날 기록 · 한국 시간{data && ` · ${dotDate(data.from)} ~ ${dotDate(data.to)}`}
          </p>
        </div>
        <div className="actions">
          <div
            role="group"
            aria-label="기간"
            style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--chip)' }}
          >
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                onClick={() => choose(p)}
                style={{
                  padding: '8px 16px',
                  border: 0,
                  borderRadius: 9,
                  background: days === p ? 'var(--surface)' : 'transparent',
                  color: days === p ? 'var(--text-1)' : 'var(--text-3)',
                  fontSize: 14,
                  fontWeight: days === p ? 700 : 500,
                }}
              >
                {p}일
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
            <CoreKpi
              label="재방문율 D7"
              value={last ? percent(last.d7Returned, last.d7Eligible) : '-'}
              sub={last ? `${monthDay(last.date)} · ${last.d7Returned} / ${last.d7Eligible}명` : ''}
            >
              <Trend content={content} value={(d) => rate(d.d7Returned, d.d7Eligible)} />
            </CoreKpi>
            <CoreKpi
              label="첫 면접 전환율"
              value={last ? percent(last.usersInterviewed, last.usersTotal) : '-'}
              sub={
                last
                  ? `${monthDay(last.date)} · 전체 회원 ${last.usersTotal}명 중 ${last.usersInterviewed}명`
                  : ''
              }
            >
              <Trend content={content} value={(d) => rate(d.usersInterviewed, d.usersTotal)} />
            </CoreKpi>
            <CoreKpi
              label="주간 연습 회원"
              value={last ? `${last.practicedWeek}명` : '-'}
              sub={last ? `${monthDay(last.date)} · 최근 7일 중 하루라도 연습` : ''}
            >
              <Trend content={content} value={(d) => d.practicedWeek} />
            </CoreKpi>
          </div>

          <section className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 12 }}>
              <h2>날짜별 기록</h2>
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>최신순 · 기록이 없는 날은 빠져요</span>
            </div>
            {empty ? (
              <p style={{ margin: 0, padding: '40px 0', textAlign: 'center', fontSize: 15, color: 'var(--text-3)' }}>
                아직 남은 기록이 없어요
              </p>
            ) : (
              <>
                <Row cells={COLUMNS.map((c) => c.head)} head />
                {[...content].reverse().map((d) => (
                  <Row key={d.date} cells={COLUMNS.map((c) => c.cell(d))} />
                ))}
              </>
            )}
          </section>
        </>
      )}
    </>
  )
}

/** 분모가 0이면 선에서 뺀다 */
function rate(count: number, total: number) {
  return total === 0 ? null : (count / total) * 100
}

function Row({ cells, head = false }: { cells: string[]; head?: boolean }) {
  return (
    <div style={{ display: 'flex', padding: head ? '10px 0' : '14px 0', borderBottom: '1px solid var(--line)' }}>
      {cells.map((text, i) => (
        <span
          key={COLUMNS[i].head}
          style={{
            flex: `${COLUMNS[i].width} 0 0`,
            minWidth: 0,
            textAlign: i === 0 ? 'left' : 'right',
            fontSize: head ? 13 : 14,
            fontWeight: head || i === 0 ? 600 : 400,
            color: head ? 'var(--text-3)' : 'var(--text-1)',
          }}
        >
          {text}
        </span>
      ))}
    </div>
  )
}

const TREND_HEIGHT = 64
// 선 끝이 잘리지 않게 좌우를 조금 비운다(Figma A05: 4px 안쪽)
const TREND_INSET = 1.5

// 기간 안의 추이 선. 선을 그을 값이 2개 미만이면 그리지 않는다
function Trend({ content, value }: { content: DailyMetric[]; value: (d: DailyMetric) => number | null }) {
  const points = content
    .map((d, i) => ({ i, y: value(d) }))
    .filter((p): p is { i: number; y: number } => p.y !== null)
  if (points.length < 2) {
    return null
  }
  const ys = points.map((p) => p.y)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const span = max - min || 1
  const last = content.length - 1
  const line = points
    .map(
      (p) =>
        `${TREND_INSET + (p.i / last) * (100 - TREND_INSET * 2)},${TREND_HEIGHT - 4 - ((p.y - min) / span) * (TREND_HEIGHT - 8)}`,
    )
    .join(' ')
  return (
    <>
      <svg
        viewBox={`0 0 100 ${TREND_HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: TREND_HEIGHT }}
        aria-hidden="true"
      >
        <polyline
          points={line}
          fill="none"
          stroke="var(--brand-ink)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)' }}>
        <span>{monthDay(content[0].date)}</span>
        <span>{monthDay(content[last].date)}</span>
      </div>
    </>
  )
}
