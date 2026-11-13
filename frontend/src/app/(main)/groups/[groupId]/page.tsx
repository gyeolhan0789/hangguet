import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { unlessTemporary } from "@/lib/api/temporary-failure";
import { getGroup, parseGroupId } from "@/lib/group/queries";
import { getSession } from "@/lib/interview/queries";
import { interviewPath, ROUTES } from "@/lib/routes";

import { GroupLobby } from "./_components/group-lobby";

export const metadata: Metadata = { title: "그룹 면접 대기실 · 한끗" };

// G01 그룹 면접 대기실. 기준: Figma [초안] G01(480:2414 2단 구성 · 483:2252 방장 · 모두 준비 · 483:2413 Dark)
// · BE Swagger 10.4 그룹 조회(대기실은 2초마다 부른다 · WAITING이 아니게 되면 멈춘다) · 5.2 내 면접(질문 준비 진행률)
// 대기 중(WAITING) · 시작 실패(START_FAILED)면 대기실을 그린다. 시작했으면(IN_PROGRESS) · 끝났으면(ENDED) 내 면접 화면으로,
// 없거나 취소된 그룹이면 홈으로 보낸다. 다른 참가자는 2초 조회로 IN_PROGRESS를 보고 면접 화면으로 넘어간다(BE 10.7 설명).
async function Lobby({ params }: Readonly<Pick<PageProps<"/groups/[groupId]">, "params">>) {
  // 대기실은 2초마다 다시 그려 10.4를 다시 부른다. 미리 그려 둘 수 없다.
  await connection();
  const { groupId: raw } = await params;
  const groupId = parseGroupId(raw);
  if (groupId === null) redirect(ROUTES.home);
  // BE가 잠깐 답하지 못하면(5xx · 연결 실패) undefined: 대기실은 직전 화면을 그대로 두고 다음 조회를 기다린다
  const group = await unlessTemporary(getGroup(groupId));
  if (group === null || group?.status === "CANCELLED") redirect(ROUTES.home);
  if (group?.status === "IN_PROGRESS" || group?.status === "ENDED") {
    redirect(interviewPath(group.mySessionId));
  }
  const mySession = group && (await unlessTemporary(getSession(group.mySessionId)));

  return (
    <GroupLobby
      // 다시 그려도(2초마다) 같은 그룹이면 카메라 · 마이크 점검 상태와 직전에 받은 그룹을 그대로 둔다.
      key={groupId}
      group={group}
      planProgress={mySession === undefined ? undefined : (mySession?.planProgress ?? null)}
    />
  );
}

export default function GroupLobbyPage({ params }: PageProps<"/groups/[groupId]">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 10.4를 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Lobby params={params} />
      </Suspense>
    </main>
  );
}
