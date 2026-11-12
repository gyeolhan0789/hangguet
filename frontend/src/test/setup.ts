import { afterEach, vi } from "vitest";

import { resetCookies } from "./next-headers";
import { resetNavigation } from "./next-navigation";

// 모든 단위 · 컴포넌트 테스트의 공통 정리(vitest.config.mts setupFiles).
// mock 호출 기록 · 구현(mockReset) · spy(restoreMocks) · vi.stubGlobal · vi.stubEnv는 설정이 테스트마다 되돌린다.
// 여기서는 설정이 하지 않는 것만 정리한다: 그린 화면, 가짜 타이머, 가짜 쿠키, 가짜 라우터의 bfcacheId.
afterEach(async () => {
  vi.useRealTimers();
  resetCookies();
  resetNavigation();
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
