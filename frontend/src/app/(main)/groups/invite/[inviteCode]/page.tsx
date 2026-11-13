import type { Metadata } from "next";
import { Suspense } from "react";

import { getApplications } from "@/lib/application/queries";
import { getInvite } from "@/lib/group/queries";

import { InviteJoinForm } from "./_components/invite-join-form";
import { InviteUnavailable } from "./_components/invite-unavailable";

export const metadata: Metadata = { title: "그룹 면접 초대 · 한끗" };

/** Swagger 4.3 size 최대값(S03과 같이 한 번만 부른다) */
const SELECT_SIZE = 20;

// G03 초대 확인 · 참가. 기준: Figma [초안] G03(484:2552) · BE Swagger 10.2 초대 확인(404 GROUP_NOT_FOUND: 없는 코드 · 이미 시작했거나
// 취소된 그룹) · 10.3 그룹 참가 · 4.3 지원서 목록. 대기실의 [초대 링크 복사]로 받은 주소로 들어온다.
async function Invite({
  params,
}: Readonly<Pick<PageProps<"/groups/invite/[inviteCode]">, "params">>) {
  const { inviteCode } = await params;
  const code = decodeCode(inviteCode);
  const [invite, list] = await Promise.all([getInvite(code), getApplications(0, SELECT_SIZE)]);
  if (!invite) return <InviteUnavailable />;
  return <InviteJoinForm inviteCode={code} invite={invite} applications={list.content} />;
}

/** 주소의 초대 코드. 잘못된 퍼센트 인코딩이면 빈 값(10.2를 부르지 않고 들어갈 수 없는 초대로 본다) */
function decodeCode(raw: string) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export default function InvitePage({ params }: PageProps<"/groups/invite/[inviteCode]">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 10.2를 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Invite params={params} />
      </Suspense>
    </main>
  );
}
