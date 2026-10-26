import { useEffect, useState } from 'react'
import { ApiError, api } from '../api'
import { CoreKpi } from '../components/CoreKpi'
import { dotDate, monthDay, percent } from '../format'
import { navigate } from '../route'
import type { AdminMetricsResponse, Criterion, Persona } from '../types'

const CRITERION_NAMES: Record<Criterion, string> = {
  JOB_FIT: '직무 적합성',
  COVER_LETTER: '자소서 검증',
  LOGIC: '논리성',
  DELIVERY: '전달력',
}
const PERSONA_NAMES: Record<Persona, string> = {
  DEVIL: '악마 면접관',
  COFFEE_CHAT: '개발자 커피챗',
}
type SpeechKey = Exclude<keyof AdminMetricsResponse['speech'], 'sessions'>
const SPEECH_ITEMS: { key: SpeechKey; label: string; unit: string }[] = [
  { key: 'fillerPerMin', label: '1분당 군말', unit: '회' },
  { key: 'longPauseCount', label: '긴 멈춤', unit: '회' },
  { key: 'speedDeviationPct', label: '말 속도 차이', unit: '%' },
  { key: 'trailingOffRatio', label: '말끝 흐림', unit: '%' },
  { key: 'pitchRangeSt', label: '억양 폭', unit: '세미톤' },
  { key: 'gazeRatio', label: '시선 맞춤', unit: '%' },
]
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

  const { users, practice, interviews, averageScores, speech, applications, inquiries, streakFreezes, notices } =
    metrics
  const maxDaily = Math.max(1, ...practice.daily.map((d) => d.users))
  const videoRatio = interviews.total === 0 ? 0 : interviews.video / interviews.total
  const maxPersona = Math.max(1, ...interviews.personas.map((p) => p.count))
  const d7 = practice.retention.find((r) => r.days === 7)

  return (
    <>
      <div className="page-title page-title-home">
        <div>
          <h1>홈</h1>
          <p className="sub">{dotDate(metrics.date)} 기준 · 한국 시간</p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            style={{ height: 45, padding: '0 18px', borderRadius: 10 }}
            onClick={() => navigate('history')}
          >
            히스토리 보기
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <CoreKpi
          label="재방문율 D7"
          value={d7 ? percent(d7.returned, d7.eligible) : '-'}
          sub={d7 ? `가입 7일째에 연습한 회원 ${d7.returned} / ${d7.eligible}명` : ''}
        />
        <CoreKpi
          label="첫 면접 전환율"
          value={percent(users.interviewed, users.total)}
          sub={`전체 회원 ${users.total}명 중 면접을 해 본 회원 ${users.interviewed}명`}
        />
        <CoreKpi label="주간 연습 회원" value={`${practice.practicedWeek}명`} sub="최근 7일 중 하루라도 연습" />
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <Kpi
          label="전체 회원"
          value={`${users.total}명`}
          sub={`오늘 가입 ${users.joinedToday}명 · 탈퇴 ${users.withdrawn}명`}
        />
        <Kpi label="오늘 연습한 회원" value={`${practice.practicedToday}명`} sub="연습 기록 기준" />
        <Kpi
          label="면접"
          value={`${interviews.total}회`}
          sub={`완료 ${interviews.completed} · 분석 중 ${interviews.analyzing} · 실패 ${interviews.failed}\n답변 없이 끝남 ${interviews.aborted} · 지원서 ${applications}개`}
        />
        <Kpi
          label="스트릭 유지권"
          value={`${streakFreezes.granted}개 지급`}
          sub={`사용 ${streakFreezes.used} · 만료 ${streakFreezes.expired}`}
        />
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <Kpi label="답변 기다리는 문의" value={`${inquiries.waiting}건`} sub="답변 대기 상태 기준" />
        <Kpi label="분석이 멈춘 면접" value={`${interviews.stuck}회`} sub="결과 요청 뒤 최대 대기 시간이 지남" />
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

      <div style={{ display: 'flex', gap: 16, marginTop: 20 }}>
        <section className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>재방문</h2>
          <div style={{ display: 'flex', gap: 16 }}>
            {practice.retention.map((r) => (
              <div key={r.days} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-3)' }}>D{r.days}</span>
                <span style={{ fontSize: 24, fontWeight: 700 }}>{percent(r.returned, r.eligible)}</span>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                  {r.returned} / {r.eligible}명
                </span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>가입한 날에서 N일째에 연습한 회원 비율</span>
        </section>

        <section className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>면접 진행</h2>
          <div style={{ display: 'flex', gap: 16 }}>
            <Ratio label="완료율" value={percent(interviews.completed, interviews.total)} />
            <Ratio
              label="답변 없이 끝남"
              value={percent(interviews.aborted, interviews.total + interviews.aborted)}
            />
          </div>
          {interviews.personas.map((p) => (
            <div key={p.persona} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ width: 96, color: 'var(--text-3)' }}>{PERSONA_NAMES[p.persona]}</span>
              <div style={{ width: 100, height: 8, borderRadius: 999, background: 'var(--chip)', overflow: 'hidden' }}>
                <div
                  style={{ width: `${(p.count / maxPersona) * 100}%`, height: '100%', background: 'var(--text-1)' }}
                />
              </div>
              <span style={{ fontWeight: 700 }}>{p.count}회</span>
            </div>
          ))}
        </section>

        <section className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>말하기 지표 평균</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 130px', columnGap: 24, rowGap: 10 }}>
            {SPEECH_ITEMS.map(({ key, label, unit }) => {
              const value = speech[key]
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 14, color: 'var(--text-3)' }}>{label}</span>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>
                    {value === null ? '-' : `${value.toFixed(1)}${unit}`}
                  </span>
                </div>
              )
            })}
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>결과가 나온 화상 면접 {speech.sessions}회 기준</span>
        </section>
      </div>
    </>
  )
}

function Ratio({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700 }}>{value}</span>
    </div>
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
