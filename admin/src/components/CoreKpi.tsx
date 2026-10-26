import type { ReactNode } from 'react'

// 핵심 지표(A00 홈 · A05 히스토리). 브랜드 색 배경에 다른 KPI보다 큰 글씨
export function CoreKpi({ label, value, sub, children }: { label: string; value: string; sub: string; children?: ReactNode }) {
  return (
    <section
      className="card"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--brand-soft)',
        borderColor: 'var(--brand)',
      }}
    >
      <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--brand-ink)' }}>{label}</span>
      <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.5, color: 'var(--brand-ink)' }}>{value}</span>
      {sub && <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{sub}</span>}
      {children}
    </section>
  )
}
