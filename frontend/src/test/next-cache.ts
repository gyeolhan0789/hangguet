import { vi } from "vitest";

/**
 * `next/cache` 대역. 사용: `vi.mock("next/cache", () => import("@/test/next-cache"))`
 * 단언할 때는 `import { refresh } from "next/cache"`로 불러온다.
 */
export const refresh = vi.fn();
export const revalidatePath = vi.fn();
export const revalidateTag = vi.fn();
export const updateTag = vi.fn();
