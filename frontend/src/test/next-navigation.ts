import { vi } from "vitest";

/**
 * `next/navigation` 대역. 사용: `vi.mock("next/navigation", () => import("@/test/next-navigation"))`
 * 단언할 때는 `import { redirect, router } from "next/navigation"`처럼 그대로 불러온다(같은 대역이 온다).
 * redirect는 Next처럼 던지고, 메시지는 "REDIRECT <주소>"다(`redirectTo`로 주소를 정확히 맞춘다).
 */
export class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`REDIRECT ${url}`);
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export const RedirectType = { push: "push", replace: "replace" } as const;

export const redirect = vi.fn((url: string): never => {
  throw new RedirectError(url);
});
export const permanentRedirect = redirect;
export const notFound = vi.fn((): never => {
  throw new NotFoundError();
});
/** Next처럼 이동 · notFound 신호만 다시 던지고 나머지 오류는 그냥 둔다 */
export const unstable_rethrow = (error: unknown) => {
  if (error instanceof RedirectError || error instanceof NotFoundError) throw error;
};

/** 처음 들어온 기록의 bfcacheId(Next useRouter). 새로 들어온 것을 흉내 내려면 `router.bfcacheId`를 바꾼다(테스트마다 setup이 되돌린다) */
export const FIRST_BFCACHE_ID = "entry-1";

export const router = {
  bfcacheId: FIRST_BFCACHE_ID,
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};
export const useRouter = () => router;
export function resetNavigation() {
  router.bfcacheId = FIRST_BFCACHE_ID;
}
export const usePathname = vi.fn(() => "/");
export const useSearchParams = vi.fn(() => new URLSearchParams());
