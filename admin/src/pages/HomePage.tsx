import { useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { dotDate, monthDay } from '../format'
import type { AdminMetricsResponse, Criterion } from '../types'

const CRITERION_NAMES: Record<Criterion, string> = {
  JOB_FIT: '직무 적합성',
  COVER_LETTER: '자소서 검증',
  LOGIC: '논리성',
  DELIVERY: '전달력',
}
const BAR_MAX_HEIGHT = 170

// A00 백오피스 홈. 8.15 관리자 메트릭 한 번으로 그린다
export function HomePage() {
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api
      .metrics()
      .then((m) => active && setMetrics(m))
      .catch((e) => active && setError(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요.'))
    return () => {
      active = false
    }
  }, [])

  if (error) {
    return <p className="error">{error}</p>
  }
  if (!metrics) {
    return null
  }

  const { users, practice, interviews, averageScores, streakFreezes, notices } = metrics
  const maxDaily = Math.max(1, ...practice.daily.map((d) => d.users))
  const videoRatio = interviews.total === 0 ? 0 : interviews.video / interviews.total

  return (
    <>
      <div className="page-title page-title-home">
        <div>
          <h1>홈</h1>
          <p className="sub">{dotDate(metrics.date)} 기준 · 한국 시간</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <Kpi label="전체 회원" value={`${users.total}명`} sub={`오늘 가입 ${users.joinedToday}명`} />
        <Kpi label="오늘 연습한 회원" value={`${practice.practicedToday}명`} sub="연습 기록 기준" />
        <Kpi
          label="면접"
          value={`${interviews.total}회`}
          sub={`완료 ${interviews.completed} · 분석 중 ${interviews.analyzing} · 실패 ${interviews.failed}\n답변 없이 끝남 ${interviews.aborted}`}
        />
        <Kpi
          label="스트릭 유지권"
          value={`${streakFreezes.granted}개 지급`}
          sub={`사용 ${streakFreezes.used} · 만료 ${streakFreezes.expired}`}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, height: 330 }}>
        <section className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>최근 7일 연습한 회원</h2>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            {practice.daily.map((d, i) => {
              const today = i === practice.daily.length - 1
              return (
                <div key={d.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: today ? 'var(--text-1)' : 'var(--text-2)' }}>
                    {d.users}
                  </span>
                  <div
                    style={{
                      width: 36,
                      height: Math.max(2, Math.round((d.users / maxDaily) * BAR_MAX_HEIGHT)),
                      borderRadius: '6px 6px 2px 2px',
                      background: today ? 'var(--text-1)' : 'var(--input-line)',
                    }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)' }}>{monthDay(d.date)}</span>
                </div>
              )
            })}
          </div>
        </section>

        <div style={{ width: 330, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>면접 방식</h2>
            <div style={{ height: 12, borderRadius: 999, background: 'var(--chip)', overflow: 'hidden' }}>
              <div style={{ width: `${videoRatio * 100}%`, height: '100%', background: 'var(--text-1)' }} />
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
              화상 {interviews.video} · 채팅 {interviews.chat}
            </span>
          </section>
          <section className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>기준별 평균 점수</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24, rowGap: 10 }}>
              {averageScores.map((s) => (
                <div key={s.criterion} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14, color: 'var(--text-3)' }}>
                    {CRITERION_NAMES[s.criterion]}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{s.score.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="card" style={{ width: 290 }}>
          <h2 style={{ marginBottom: 8 }}>게시 중 공지 확인</h2>
          {notices.map((n) => (
            <div
              key={n.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 0',
                borderBottom: '1px solid var(--line)',
                fontSize: 15,
              }}
            >
              <span style={{ flex: 1, fontWeight: 500 }}>{n.title}</span>
              <span style={{ fontWeight: 700 }}>{n.readCount}명</span>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <section className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.4 }}>{value}</span>
      <span style={{ fontSize: 13, color: 'var(--text-3)', whiteSpace: 'pre-line' }}>{sub}</span>
    </section>
  )
}
