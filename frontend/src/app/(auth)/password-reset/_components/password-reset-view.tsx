"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ROUTES } from "@/lib/routes";

import { PasswordResetForm } from "./password-reset-form";

// 한 번 본 화면은 상태를 살려 다시 보여 주므로(cacheComponents · Activity), 새 링크로 들어올 때마다 새로 그린다(회원가입과 같은 방식).
export function PasswordResetView({ token }: { token: string }) {
  const { bfcacheId } = useRouter();
  // 주소에서 token을 지우면 화면이 token 없는 주소로 다시 그려진다. 처음 받은 token을 들고 있는다.
  const [linkToken, setLinkToken] = useState(token);
  if (token && token !== linkToken) setLinkToken(token);

  // token은 읽었으니 주소에서 지운다(방문 기록 · 화면 공유로 새지 않게). 새로 고치면 링크를 다시 눌러야 한다.
  useEffect(() => {
    if (token) window.history.replaceState(null, "", ROUTES.passwordReset);
  }, [token]);

  return <PasswordResetForm key={`${bfcacheId}:${linkToken}`} token={linkToken} />;
}
