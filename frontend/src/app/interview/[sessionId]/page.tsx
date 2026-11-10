import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getCurrentQuestion, getSession, parseSessionId } from "@/lib/interview/queries";
import { devicesPath, ROUTES, resultPath } from "@/lib/routes";

import { InterviewRoom } from "./_components/interview-room";

export const metadata: Metadata = { title: "면접 · 한끗" };

// S06 면접 진행(화상) · S06-B(채팅) · S06-E 종료 확인 · S06-1 결과 분석 중. 앱 헤더 없이 화면 전체를 쓴다(Figma S06 1440×900).
// 기준: Figma S06(18:2497) · S06-B(18:2574) · S06-E(18:4226) · S06-1(18:4437) · 웹 Swagger 5.2 면접 조회(면접의 현재 상태) · 5.5 지금 질문
// 면접이 없으면 S05와 같이 처음 단계(S03)로 보낸다. 다음 질문 · 결과 분석을 기다릴 때는 화면이 2초마다 다시 그려 5.2를 다시 부른다.
// 결과가 나오면(COMPLETED) S07 피드백 결과로 넘어간다(Figma 흐름 S06 → S07 · 웹 Swagger 5.2 status COMPLETED '결과 있음').
// 답변 없이 끝난 면접(ABORTED)은 홈으로(웹 Swagger 5.8 200 예시 '답변 0개 → 홈'), 시작 전 화상 면접(READY)은 S05 장치 점검으로
// 보낸다(화상은 S05에서 [면접 시작](5.4)을 눌러 시작한다).
async function Interview({
  params,
}: Readonly<Pick<PageProps<"/interview/[sessionId]">, "params">>) {
  // 면접은 요청할 때마다 새로 그린다(5.2 · 5.5는 매번 달라 미리 그려 둘 수 없다). 동적 경로(sessionId)라 이것이 없으면
  // Next가 요청 때 셸을 한 번 더 그리면서 5.2 · 5.5를 두 번씩 부른다(E2E로 확인).
  await connection();
  const { sessionId: raw } = await params;
  const sessionId = parseSessionId(raw);
  const session = sessionId === null ? null : await getSession(sessionId);
  if (!session) redirect(ROUTES.practice);
  if (session.status === "COMPLETED") redirect(resultPath(session.id));
  if (session.status === "ABORTED") redirect(ROUTES.home);
  if (session.mode === "VIDEO" && session.status === "READY") redirect(devicesPath(session.id));
  // 면접 중이면 지금 답할 질문은 5.5로 받는다(다음 질문을 만드는 중이면 null).
  const question = session.status === "IN_PROGRESS" ? await getCurrentQuestion(session.id) : null;

  // 다시 그려도(2초마다) 같은 면접이면 3D 장면 · 카메라 · 입력 중인 답변을 그대로 둔다.
  return <InterviewRoom key={session.id} session={session} currentQuestion={question} />;
}

export default function InterviewPage({ params }: PageProps<"/interview/[sessionId]">) {
  return (
    // S06 계열은 라이트 · 다크 구분 없이 늘 어두운 화면이다(Figma 배경 #0b0d14 = night).
    <main className="relative flex h-dvh flex-col overflow-hidden bg-night">
      {/* 5.2를 불러오는 동안은 어두운 배경만 둔다(Figma에 로딩 화면이 없다). */}
      <Suspense fallback={null}>
        <Interview params={params} />
      </Suspense>
    </main>
  );
}
