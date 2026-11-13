import Link from "next/link";

import { ROUTES } from "@/lib/routes";

// 기준: BE Swagger 10.2 404 GROUP_NOT_FOUND(없는 코드 · 이미 시작했거나 취소된 그룹). Figma에 이 화면이 없어 G03 제목 · 설명 모양을 따른다.

export function InviteUnavailable() {
  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-10">
      <div className="flex w-full max-w-[640px] flex-col gap-6">
        <div className="flex flex-col gap-1.5 leading-normal">
          <h1 className="text-[26px] font-bold text-text-1">들어갈 수 없는 초대예요</h1>
          <p className="text-[15px] font-medium text-text-2">
            초대 코드가 틀렸거나, 이미 시작했거나 취소된 그룹이에요
          </p>
        </div>
        <Link
          href={ROUTES.home}
          className="self-start rounded-xl bg-surface px-[22px] py-3 text-base leading-normal font-bold text-text-1"
        >
          홈으로
        </Link>
      </div>
    </div>
  );
}
