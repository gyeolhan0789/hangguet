import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PhotoField, usePhotoPicks } from "./photo-picker";

// 기준: Swagger 9.11(JPG · PNG, 5MB 이하, 메시지당 5장) · 사용자 결정(2026-11-03: I01 · I01-B '사진' 칸은 사진 칸 방식,
// 칸마다 × 빼기, 끝에 '추가' 칸(5장이면 사라짐), 'N / 5' · 안내 문구)

const { createObjectURL, revokeObjectURL } = URL;
const revoke = vi.fn();

beforeAll(() => {
  // jsdom에는 미리보기 주소를 만드는 함수가 없다
  URL.createObjectURL = (file: Blob) => `blob:${(file as File).name}`;
  URL.revokeObjectURL = revoke;
});
afterAll(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});
afterEach(() => {
  cleanup();
  revoke.mockReset();
});

function Form() {
  const picks = usePhotoPicks();
  return <PhotoField picks={picks} />;
}

const photo = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });
const pick = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText("사진 파일"), { target: { files } });
const tiles = () => screen.queryAllByRole("img", { name: /고른 사진/ });

describe("PhotoField (I01 · I01-B 사진)", () => {
  it("장수 · 안내를 보여 주고, 고른 사진 칸 뒤에 '추가' 칸을 둔다", () => {
    render(<Form />);

    expect(screen.getByText("0 / 5")).toBeTruthy();
    expect(screen.getByText("JPG · PNG, 5MB 이하 · 최대 5장")).toBeTruthy();
    pick(photo("a.png"), photo("b.png"));

    expect(tiles()).toHaveLength(2);
    expect(screen.getByText("2 / 5")).toBeTruthy();
    expect(screen.getByRole("button", { name: "사진 추가" })).toBeTruthy();
  });

  it("5장이면 '추가' 칸이 사라지고, 남은 칸보다 많이 고르면 남은 만큼만 받고 알린다", () => {
    render(<Form />);

    pick(...["1", "2", "3", "4"].map((n) => photo(`${n}.png`)));
    pick(photo("5.png"), photo("6.png"));

    expect(tiles()).toHaveLength(5);
    expect(screen.getByRole("alert").textContent).toBe("사진은 5장까지 붙일 수 있습니다.");
    expect(screen.queryByRole("button", { name: "사진 추가" })).toBeNull();
  });

  it("빼면 미리보기 주소를 해제하고 '추가' 칸이 다시 생긴다", () => {
    render(<Form />);
    pick(...["1", "2", "3", "4", "5"].map((n) => photo(`${n}.png`)));

    fireEvent.click(screen.getByRole("button", { name: "사진 2 빼기" }));

    expect(revoke).toHaveBeenCalledWith("blob:2.png");
    expect(tiles()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "사진 추가" })).toBeTruthy();
  });

  it("화면을 떠나면 남은 미리보기 주소를 모두 해제한다", () => {
    const { unmount } = render(<Form />);
    pick(photo("a.png"), photo("b.png"));

    unmount();

    expect(revoke).toHaveBeenCalledWith("blob:a.png");
    expect(revoke).toHaveBeenCalledWith("blob:b.png");
  });
});
