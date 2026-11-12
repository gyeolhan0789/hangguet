import type { ComponentProps } from "react";

/**
 * `next/form` 대역: 주소(action)로 이동하는 GET 폼을 그냥 `<form>`으로 그린다(Next 라우터 없이 그리기 위해).
 * 사용: `vi.mock("next/form", () => import("@/test/next-form"))`
 * 제출 결과는 폼 안의 값(이름 · 값)과 action 주소로 확인한다. 실제 이동은 E2E가 본다.
 */
export default function Form({ action, ...props }: Readonly<ComponentProps<"form">>) {
  return <form action={typeof action === "string" ? action : undefined} {...props} />;
}
