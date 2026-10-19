import { Suspense } from "react";

import { AppNav, AppNavSkeleton, Header } from "@/layouts/header";
import { getMe } from "@/lib/auth/session";

async function MainNav() {
  const me = await getMe();
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
