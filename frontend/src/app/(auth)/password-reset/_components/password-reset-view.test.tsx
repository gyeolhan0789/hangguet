import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PasswordResetView } from "./password-reset-view";

// 주소의 token을 읽은 뒤 지우는지만 본다. 폼 동작은 password-reset-form.test.tsx가 본다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ bfcacheId: "1" }) }));
vi.mock("@/lib/auth/actions", () => ({ resetPassword: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PasswordResetView", () => {
  it("token이 있으면 주소에서 token을 지운다", () => {
    // 실제 jsdom 주소는 바꾸지 않는다(다른 테스트와 섞이지 않게)
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

    render(<PasswordResetView token="token-1" />);

    expect(replaceState).toHaveBeenCalledWith(null, "", "/password-reset");
  });

  it("token이 없으면 주소를 건드리지 않는다", () => {
    // 실제 jsdom 주소는 바꾸지 않는다(다른 테스트와 섞이지 않게)
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});

    render(<PasswordResetView token="" />);

    expect(replaceState).not.toHaveBeenCalled();
  });

  it("주소에서 token을 지워 token 없이 다시 그려져도 처음 받은 token으로 바꾼다", () => {
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    const { rerender } = render(<PasswordResetView token="token-1" />);

    rerender(<PasswordResetView token="" />);

    expect(screen.getByLabelText("새 비밀번호")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "재설정 링크 다시 받기" })).toBeNull();
  });
});
