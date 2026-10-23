import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSession, parseSessionId } from "@/lib/interview/queries";
import { interviewPath, ROUTES } from "@/lib/routes";

import { DevicesCheck } from "./_components/devices-check";
import { DevicesSkeleton } from "./_components/devices-skeleton";

export const metadata: Metadata = { title: "장치 점검 · 한끗" };

// S05 장치 점검(연습 시작 4단계, 화상만). 기준: Figma S05(18:2333) · S05-E(18:4013) · Swagger 5.2 면접 조회
// 질문 준비 중이면 화면이 2초마다 다시 그려지며(PlanProgress의 router.refresh) 여기서 5.2를 다시 부른다.
// 면접이 없으면 S03으로, 채팅 면접이면(장치 점검이 필요 없다) 면접 화면으로 보낸다.
// 면접 상태(status)로는 보내지 않는다(웹 목 서버의 5.2 실제 응답은 늘 'S06·S06-B 면접 중'(IN_PROGRESS) 예시다).
// 이미 시작 · 종료한 면접이면 [면접 시작](5.4)이 409 INVALID_SESSION_STATE 문구로 알린다.
async function Devices({ searchParams }: Pick<PageProps<"/practice/devices">, "searchParams">) {
  const params = await searchParams;
  const sessionId = parseSessionId(params.sessionId);
  const session = sessionId === null ? null : await getSession(sessionId);
  if (!session) redirect(ROUTES.practice);
  if (session.mode === "CHAT") redirect(interviewPath(session.id));

  return (
    <DevicesCheck
      // 다시 그려도(2초마다) 같은 면접이면 장치 점검 상태 · 카메라 스트림을 그대로 둔다.
      key={session.id}
      sessionId={session.id}
      applicationId={session.applicationId}
      persona={session.persona}
      planStatus={session.planStatus}
      planProgress={session.planProgress}
    />
  );
}

export default function DevicesPage({ searchParams }: PageProps<"/practice/devices">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<DevicesSkeleton />}>
        <Devices searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
