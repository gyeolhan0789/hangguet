import { NextResponse } from "next/server";

// Route Handler에서 사이트 안 경로로 보낸다. Location에 경로만 넣는다(상대 리다이렉트).
// standalone 컨테이너에서는 request.url이 https://0.0.0.0:3000이라 new URL(path, request.url)로 절대 주소를 만들면
// 브라우저가 그 주소로 간다. NextResponse.redirect는 절대 주소만 받으므로 직접 만든다(기본과 같은 307).

/** path는 '/'로 시작하는 사이트 안 경로여야 한다(safeNextPath · pathAfterSignedOut · ROUTES로 고른 값). */
export function redirectToPath(path: string) {
  // '//' · '/\'는 브라우저가 다른 사이트 주소로 읽는다
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    throw new Error(`사이트 안 경로가 아닙니다: ${path}`);
  }
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}
