"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";

import { RowButton } from "@/app/(main)/practice/devices/_components/check-row";
import { useRequestKey } from "@/components/use-request-key";
import { ProgressBar } from "@/components/progress-bar";
import { useOnline } from "@/components/use-online";
import { leaveGroup, setGroupReady, startGroup } from "@/lib/group/actions";
import { jobCategoryLabel } from "@/lib/group/job-categories";
import { retryPlan } from "@/lib/interview/actions";
import { MODE_SHORT_LABEL } from "@/lib/interview/modes";
import { PERSONAS } from "@/lib/interview/personas";
import { preloadInterviewer } from "@/lib/interviewer/preload";
import { groupInvitePath } from "@/lib/routes";
import type { GroupResponse } from "@/types/api";

import {
  GroupActionBar,
  GroupPrimaryButton,
  GroupSecondaryButton,
} from "../../_components/group-action-bar";

import { useLobbyDevices } from "./lobby-devices";
import { ParticipantList } from "./participant-list";

// 기준: Figma [초안] G01 그룹 면접 대기실(480:2414: 제목 '그룹 면접 대기실' 26 Bold · '직군 · 방식 · 면접관 · n/정원명' 15
// · 오른쪽 위 '초대 코드 K7Q2ZP' · [초대 링크 복사] · 왼쪽 카메라 · 오른쪽 참가자 · 카메라 · 마이크 · 질문 준비 막대
// '내 질문을 준비하고 있어요 50%' · 아래 [나가기] · [준비 완료]) · 483:2252 방장 · 모두 준비('모두 질문 준비를 마쳤어요 100%'
// · [준비 취소] · [면접 시작])
// · BE Swagger 10.4(2초마다 다시 부른다(임시 값) · WAITING이 아니게 되면 멈춘다) · 10.5 준비(화상은 장치 점검 뒤) · 10.6 나가기
// · 10.7 시작(방장만, 처음에는 정원이 차고 모두 준비 · 질문 준비 완료, START_FAILED에서는 남은 2명 이상. 안 되면 서버 문구)
// · 5.3 질문 준비 재시도(S05와 같은 '면접 준비에 실패했어요' + [다시 시도], 사용자 결정 2026-10-22)
// 사용자 결정(2026-11-13, 빈칸 기본안): 시작 실패(START_FAILED)도 같은 대기실 · 방장 [면접 시작]으로 다시 시작하고 이유는 10.7 서버 문구로
// 보인다 · 준비한 일반 참가자는 [준비 취소]만 둔다 · 질문 준비 막대는 내 질문 준비 중이면 '내 질문을 준비하고 있어요'(내 진행률),
// 모두 끝나면 '모두 질문 준비를 마쳤어요', 내 것만 끝났으면 100%로 앞 문구를 둔다 · 화상 장치 실패는 S05와 같은 [다시 확인] · 권한 모달
// · 채팅 대기실은 카메라 칸 없이 오른쪽 칸만 둔다(채팅은 장치 점검이 없다 · S05-1 기획 메모).

/** 대기실을 다시 조회하는 간격(BE Swagger 10.4 "2초마다(임시 값)") */
export const LOBBY_POLL_MS = 2000;

export function GroupLobby({
  group: received,
  planProgress: receivedProgress,
}: Readonly<{
  /** 10.4. 2초 조회에서 BE가 잠깐 답하지 못했으면 undefined(직전에 받은 그룹을 그대로 둔다) */
  group: GroupResponse | undefined;
  /** 5.2 내 질문 준비 진행률. 받지 못했으면 undefined(직전 값을 둔다) */
  planProgress: number | null | undefined;
}>) {
  // 2초 조회 한 번이 잠깐 실패해도(배포 중 502 등) 대기실을 오류 화면으로 바꾸지 않고 다음 조회를 기다린다
  const [kept, setKept] = useState({ group: received, planProgress: receivedProgress ?? null });
  if (
    (received !== undefined && received !== kept.group) ||
    (receivedProgress !== undefined && receivedProgress !== kept.planProgress)
  ) {
    setKept({
      group: received ?? kept.group,
      planProgress: receivedProgress === undefined ? kept.planProgress : receivedProgress,
    });
  }
  // 처음부터 받지 못했으면 보여 줄 대기실이 없어 오류 화면으로 넘긴다
  if (!kept.group) throw new Error("그룹을 불러오지 못했어요");
  const group = kept.group;
  const planProgress = kept.planProgress;
  const router = useRouter();
  const online = useOnline();
  const [refreshing, startRefresh] = useTransition();
  const [readyPending, startReady] = useTransition();
  const [leaving, startLeaving] = useTransition();
  const [starting, startStarting] = useTransition();
  const [retrying, startRetry] = useTransition();
  const [formError, setFormError] = useState<string>();
  // 10.7 멱등 키: 응답을 못 받아 다시 보내면 같은 키, 서버가 실패로 답했으면(keySpent) 새 키
  const startKey = useRequestKey();
  const [devicesOk, setDevicesOk] = useState(false);

  const video = group.mode === "VIDEO";
  const me = group.participants.find((participant) => participant.sessionId === group.mySessionId);
  const host = me?.userId === group.hostUserId;
  const ready = me?.ready ?? false;

  // 대기실은 2초마다 다시 그려 서버 컴포넌트가 10.4를 다시 부른다(조회는 서버 컴포넌트 — AGENTS.md).
  // 다시 그리기가 끝난 뒤에 다음 조회를 예약해 요청이 겹치지 않게 한다.
  useEffect(() => {
    if (refreshing || !online) return;
    const timer = setTimeout(() => startRefresh(() => router.refresh()), LOBBY_POLL_MS);
    return () => clearTimeout(timer);
  }, [refreshing, online, router]);

  // 기다리는 동안 면접관 3D 모델을 미리 받아 둔다(S05와 같다).
  useEffect(() => {
    if (video) preloadInterviewer(group.persona);
  }, [video, group.persona]);

  const everyoneReady = group.participants.every(
    (participant) => participant.ready && participant.planStatus === "READY",
  );
  const enoughPeople =
    group.status === "START_FAILED"
      ? group.participants.length >= 2
      : group.participants.length === group.capacity;
  const canStart = everyoneReady && enoughPeople;

  function run(action: () => Promise<{ formError?: string; keySpent?: true }>) {
    setFormError(undefined);
    return async () => {
      const result = await action();
      if (result.formError) setFormError(result.formError);
      if (result.keySpent) startKey.spend();
    };
  }

  const personaName = PERSONAS.find((info) => info.persona === group.persona)?.name;
  const subtitle = [
    jobCategoryLabel(group.jobCategory),
    MODE_SHORT_LABEL[group.mode],
    personaName,
    `${group.participants.length}/${group.capacity}명`,
  ].join(" · ");

  const side = (deviceRows: ReactNode) => (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <ParticipantList group={group} mySessionId={group.mySessionId} />
      {deviceRows}
      <LobbyPlan
        group={group}
        progress={planProgress}
        retrying={retrying}
        onRetry={() => startRetry(run(() => retryPlan(group.mySessionId)))}
      />
      <AnimatePresence initial={false}>
        {formError && (
          <motion.p
            key={formError}
            role="alert"
            className="text-sm leading-normal font-semibold text-danger"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, x: [-4, 4, -2, 2, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            {formError}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center px-4 pt-10 pb-10">
        <div className="flex w-full max-w-[1040px] flex-col gap-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1.5 leading-normal">
              <h1 className="text-[26px] font-bold text-text-1">그룹 면접 대기실</h1>
              <p className="text-[15px] font-medium text-text-2">{subtitle}</p>
            </div>
            {group.inviteCode && <InviteCode code={group.inviteCode} />}
          </div>

          {video ? (
            <VideoBody onDevicesChange={setDevicesOk} side={side} />
          ) : (
            <div className="flex w-full max-w-[560px] self-center">{side(null)}</div>
          )}
        </div>
      </div>

      <GroupActionBar>
        <GroupSecondaryButton
          pending={leaving}
          onClick={() => startLeaving(run(() => leaveGroup(group.groupId)))}
        >
          나가기
        </GroupSecondaryButton>
        <div className="flex items-center gap-2">
          {ready && (
            <GroupSecondaryButton
              tone={host ? "outline" : "surface"}
              pending={readyPending}
              onClick={() => startReady(run(() => setGroupReady(group.groupId, false)))}
            >
              준비 취소
            </GroupSecondaryButton>
          )}
          {!ready && (
            <GroupPrimaryButton
              // 준비는 '내 질문 준비가 끝났고 시작해도 된다'는 뜻이라 내 질문 준비가 끝나야 누를 수 있다
              // (사용자 결정 2026-11-13. Figma G01 · BE 10.5는 질문 준비 중에도 준비할 수 있게 그렸다)
              disabled={(video && !devicesOk) || me?.planStatus !== "READY"}
              pending={readyPending}
              onClick={() => startReady(run(() => setGroupReady(group.groupId, true)))}
            >
              준비 완료
            </GroupPrimaryButton>
          )}
          {ready && host && (
            <GroupPrimaryButton
              disabled={!canStart}
              pending={starting}
              onClick={() =>
                startStarting(
                  run(() => startGroup(group.groupId, startKey.keyFor({ groupId: group.groupId }))),
                )
              }
            >
              면접 시작
            </GroupPrimaryButton>
          )}
        </div>
      </GroupActionBar>
    </div>
  );
}

/** 화상: 왼쪽 카메라 미리보기 · 오른쪽 칸(장치 줄 포함). 카메라는 화상일 때만 켠다 */
function VideoBody({
  onDevicesChange,
  side,
}: Readonly<{
  onDevicesChange: (ok: boolean) => void;
  side: (deviceRows: ReactNode) => ReactNode;
}>) {
  const report = useCallback((ok: boolean) => onDevicesChange(ok), [onDevicesChange]);
  const { preview, rows, permission } = useLobbyDevices(report);
  return (
    <div className="flex w-full flex-col gap-8 lg:flex-row lg:items-start">
      {preview}
      {side(rows)}
      {permission}
    </div>
  );
}

/** 오른쪽 위 초대 코드와 [초대 링크 복사](Figma G01 Invite: '초대 코드' 11 · 코드 18 ExtraBold 자간 넓게 · 버튼 surface) */
function InviteCode({ code }: Readonly<{ code: string }>) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(groupInvitePath(code), location.origin).href);
    } catch {
      // 복사를 막은 브라우저면 화면의 초대 코드를 그대로 알려 주면 된다.
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-3 self-start rounded-2xl border border-line bg-bg-sub py-1.5 pr-1.5 pl-4">
      <span className="text-[11px] leading-normal font-medium text-text-3">초대 코드</span>
      <span className="text-lg leading-normal font-extrabold tracking-[3px] text-text-1">
        {code}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="cursor-pointer rounded-xl bg-surface px-3 py-2 text-[13px] leading-normal font-bold text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        초대 링크 복사
      </button>
    </div>
  );
}

/**
 * 질문 준비 막대(Figma G01: brand-soft 줄 · 왼쪽 문구 13 Bold brand-ink · 오른쪽 % · 아래 막대).
 * 실패하면 S05와 같은 '면접 준비에 실패했어요' + [다시 시도](5.3).
 */
function LobbyPlan({
  group,
  progress,
  retrying,
  onRetry,
}: Readonly<{
  group: GroupResponse;
  progress: number | null;
  retrying: boolean;
  onRetry: () => void;
}>) {
  const mine = group.participants.find(
    (participant) => participant.sessionId === group.mySessionId,
  );
  if (mine?.planStatus === "FAILED") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-danger-soft px-3 py-3 dark:bg-danger-soft/14">
        <p className="text-[13px] leading-normal font-bold text-danger">면접 준비에 실패했어요</p>
        <RowButton icon="/devices/icon-rotate-cw.svg" onClick={onRetry} pending={retrying}>
          다시 시도
        </RowButton>
      </div>
    );
  }
  const generating = mine?.planStatus !== "READY";
  const allReady = group.participants.every((participant) => participant.planStatus === "READY");
  const percent = generating ? Math.min(100, Math.max(0, progress ?? 0)) : 100;
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-brand-soft px-3 py-3 dark:bg-brand-soft/8">
      <div className="flex items-center justify-between gap-2 text-[13px] leading-normal font-bold text-brand-ink">
        <p>{allReady ? "모두 질문 준비를 마쳤어요" : "내 질문을 준비하고 있어요"}</p>
        <p className="font-extrabold">{percent}%</p>
      </div>
      <ProgressBar
        label="질문 준비"
        value={percent}
        duration={0.6}
        className="h-1.5 w-full bg-bg-sub"
        fillClassName="bg-brand-strong"
      />
    </div>
  );
}
