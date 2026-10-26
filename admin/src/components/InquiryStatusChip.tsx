import type { InquiryStatus } from '../types'

const LABEL: Record<InquiryStatus, string> = { WAITING: '답변 대기', ANSWERED: '답변함', CLOSED: '종료' }

/** 문의 상태 칩. 답변 대기(처리할 일)는 검게 눈에 띄게, 종료는 흐리게(Figma A04) */
export function InquiryStatusChip({ status }: { status: InquiryStatus }) {
  return <span className={`status inquiry-status status-${status.toLowerCase()}`}>{LABEL[status]}</span>
}
