import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { parseSessionId } from "@/lib/interview/queries";
import { getReplay } from "@/lib/result/queries";
import { ROUTES, interviewPath } from "@/lib/routes";

import { ReplayView } from "./_components/replay-view";

export const metadata: Metadata = { title: "면접 다시보기 · 한끗" };

// S07-1 면접 다시보기. 기준: Figma S07-1(18:4478) · 웹 Swagger 6.4 다시보기(409 RESULT_NOT_READY · NO_RESULT)
// · 사용자 결정(2026-10-22: 면접이 없거나(404) 결과가 없으면(NO_RESULT) 다른 면접 화면과 같이 S03 지원서 선택으로 보낸다)
async function Replay({
  params,
}: Readonly<Pick<PageProps<"/interview/[sessionId]/replay">, "params">>) {
  const { sessionId: raw } = await params;
  const sessionId = parseSessionId(raw);
  if (sessionId === null) redirect(ROUTES.practice);
  const loaded = await getReplay(sessionId);
  if (loaded.status !== "ok") {
    redirect(loaded.status === "analyzing" ? interviewPath(sessionId) : ROUTES.practice);
  }
  return <ReplayView replay={loaded.data} />;
}

export default function ReplayPage({ params }: PageProps<"/interview/[sessionId]/replay">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 6.4를 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Replay params={params} />
      </Suspense>
    </main>
  );
}
