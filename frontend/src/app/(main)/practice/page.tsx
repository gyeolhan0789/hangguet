import type { Metadata } from "next";

import { ApplicationForm } from "./_components/application-form";

export const metadata: Metadata = { title: "지원서 입력 · 한끗" };

// S03 지원서 입력(연습 시작 1단계). MVP는 지원서를 고르지 않고 면접할 때마다 새로 입력한다(Figma 메모 S03).
export default function PracticePage() {
  return (
    <main className="flex flex-1 flex-col">
      <ApplicationForm />
    </main>
  );
}
