import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { parseSessionId } from "@/lib/interview/queries";
import { getResult } from "@/lib/result/queries";
import { ROUTES, interviewPath } from "@/lib/routes";

import { ResultView } from "./_components/result-view";

export const metadata: Metadata = { title: "피드백 결과 · 한끗" };

// S07 피드백 결과. 기준: Figma S07(18:2620) · 웹 Swagger 6.3 면접 결과(409 RESULT_NOT_READY · NO_RESULT) · RESULT_NOT_READY면 S06-1 분석 중 화면으로
// · 사용자 결정(2026-10-22: 면접이 없거나(404) 결과가 없으면(NO_RESULT) 다른 면접 화면과 같이 S03 지원서 선택으로 보낸다)
async function Result({ params }: Pick<PageProps<"/interview/[sessionId]/result">, "params">) {
  const { sessionId: raw } = await params;
  const sessionId = parseSessionId(raw);
  if (sessionId === null) redirect(ROUTES.practice);
  const loaded = await getResult(sessionId);
  if (loaded.status !== "ok") {
    redirect(loaded.status === "analyzing" ? interviewPath(sessionId) : ROUTES.practice);
  }
  return <ResultView result={loaded.data} />;
}

export default function ResultPage({ params }: PageProps<"/interview/[sessionId]/result">) {
  return (
    <main className="flex flex-1 flex-col">
      {/* 6.3을 불러오는 동안 보여 줄 화면은 Figma에 없다. */}
      <Suspense fallback={null}>
        <Result params={params} />
      </Suspense>
    </main>
  );
}
