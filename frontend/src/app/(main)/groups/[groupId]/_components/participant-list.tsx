import { jobCategoryLabel } from "@/lib/group/job-categories";
import type { GroupResponse } from "@/types/api";

// 기준: Figma [초안] G01 참가자 카드(480:2414: '참가자 n/정원' 15 ExtraBold · 오른쪽 '모두 준비하면 방장이 시작해요' 11 text-3
// · 줄: 첫 글자 원 32 · 닉네임 14 Bold(나는 '(나)') · '방장' 주황 뱃지 · 직군 12 text-3 · 오른쪽 '준비 완료' 초록 · '준비 전' 회색 뱃지
// · 빈자리: 점선 원 '+' · '빈자리 · 초대를 기다려요')
// 다크에서 '준비 완료' 바탕은 다른 화면(stat-tiles 등)과 같이 옅게(success-soft/14)

export function ParticipantList({
  group,
  mySessionId,
}: Readonly<{ group: GroupResponse; mySessionId: number }>) {
  const empty = Math.max(0, group.capacity - group.participants.length);
  return (
    <section
      aria-label="참가자"
      className="flex flex-col gap-3 rounded-2xl bg-bg-sub px-4 py-4 leading-normal"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold text-text-1">
          참가자 {group.participants.length}/{group.capacity}
        </h2>
        <p className="text-[11px] font-medium text-text-3">모두 준비하면 방장이 시작해요</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {group.participants.map((participant) => {
          const me = participant.sessionId === mySessionId;
          const host = participant.userId === group.hostUserId;
          return (
            <li key={participant.sessionId} className="flex items-center gap-3">
              <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface text-[13px] font-bold text-text-2">
                {participant.nickname.slice(0, 1)}
                {participant.profileImageUrl && (
                  // 사진이 있으면 첫 글자 위에 덮는다(Avatar와 같이 배경 그림으로 그린다).
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url("${participant.profileImageUrl}")` }}
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-bold text-text-1">
                    {participant.nickname}
                    {me && " (나)"}
                  </span>
                  {host && (
                    <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-ink dark:bg-brand-soft/8">
                      방장
                    </span>
                  )}
                </span>
                <span className="text-xs font-medium text-text-3">
                  {jobCategoryLabel(participant.jobCategory)}
                </span>
              </span>
              <StatusBadge participant={participant} />
            </li>
          );
        })}
        {Array.from({ length: empty }, (_, index) => (
          <li key={`empty-${index}`} className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-sm text-text-3"
            >
              +
            </span>
            <span className="text-[13px] font-medium text-text-3">빈자리 · 초대를 기다려요</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 참가자 뱃지(Figma G01: '준비 완료' 초록 · '준비 전' 회색) */
function StatusBadge({
  participant,
}: Readonly<{ participant: GroupResponse["participants"][number] }>) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${participant.ready ? "bg-success-soft text-success dark:bg-success-soft/14" : "bg-surface text-text-2"}`}
    >
      {participant.ready ? "준비 완료" : "준비 전"}
    </span>
  );
}
