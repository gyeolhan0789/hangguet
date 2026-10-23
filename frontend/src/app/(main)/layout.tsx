import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";

import { AppNav, AppNavSkeleton, Header } from "@/layouts/header";
import { getMe } from "@/lib/auth/session";

async function MainNav() {
  let me: Awaited<ReturnType<typeof getMe>> = null;
  try {
    me = await getMe();
  } catch (error) {
    // 재발급 · 로그아웃 이동, 요청마다 그려야 한다는 Next 신호는 Next가 처리하도록 다시 던진다.
    unstable_rethrow(error);
    // 내 정보(2.1)가 실패해도(500 등) 화면 본문은 열려야 하므로 헤더 메뉴만 비운다(랜딩 헤더와 같은 방식). 원인은 서버 로그에 남긴다.
    console.error("앱 헤더: 내 정보(2.1)를 불러오지 못했어요.", error);
  }
  return me ? <AppNav user={me} /> : null;
}

// 로그인 후 앱 화면의 기본 레이아웃: 위에 앱 헤더(C/App Header), 아래에 화면.
// 로그인 여부는 proxy가 이미 확인했으므로 여기서는 헤더에 보일 내 정보만 불러온다.
export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header>
        <Suspense fallback={<AppNavSkeleton />}>
          <MainNav />
        </Suspense>
      </Header>
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
