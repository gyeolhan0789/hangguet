import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PhotoComposer, PhotoField, usePhotoPicks } from "./photo-picker";

// 기준: Swagger 9.11(JPG · PNG, 5MB 이하, 메시지당 5장) · 사용자 결정(2026-11-03: 첫 문의는 내용 아래 사진 칸(끝에 '추가' 칸),
// 이어서 쓰기는 입력 상자 안 왼쪽 아래 사진 버튼 · 글 위 사진, 칸마다 빼기 버튼)

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

function Composer() {
  const picks = usePhotoPicks();
  return <PhotoComposer id="content" heightClass="h-24" aria-label="내용" picks={picks} />;
}

function Field() {
  const picks = usePhotoPicks();
  return <PhotoField picks={picks} />;
}

const photo = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });
const pick = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText("사진 파일"), { target: { files } });
const tiles = () => screen.queryAllByRole("img", { name: /고른 사진/ });
const photoButton = () => screen.getByRole("button", { name: "사진 붙이기" });

describe("PhotoComposer (I03 이어서 쓰기)", () => {
  it("사진을 고르기 전에는 안내를, 고르면 글 위에 사진과 고른 장수를 보여 준다", () => {
    render(<Composer />);

    expect(screen.getByText("JPG · PNG, 5MB 이하 · 최대 5장")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "고른 사진" })).toBeNull();
    pick(photo("a.png"), photo("b.png"));

    expect(tiles()).toHaveLength(2);
    expect(screen.getByText("사진 2 / 5")).toBeTruthy();
    expect(screen.getByLabelText("내용")).toBeTruthy();
  });

  it("5장이면 사진 버튼을 막고, 남은 칸보다 많이 고르면 남은 만큼만 받는다", () => {
    render(<Composer />);

    pick(...["1", "2", "3", "4"].map((n) => photo(`${n}.png`)));
    pick(photo("5.png"), photo("6.png"));

    expect(tiles()).toHaveLength(5);
    expect(photoButton().hasAttribute("disabled")).toBe(true);
  });

  it("빼면 미리보기 주소를 해제하고 사진 버튼을 다시 쓸 수 있다", () => {
    render(<Composer />);
    pick(...["1", "2", "3", "4", "5"].map((n) => photo(`${n}.png`)));

    fireEvent.click(screen.getByRole("button", { name: "사진 2 빼기" }));

    expect(revoke).toHaveBeenCalledWith("blob:2.png");
    expect(tiles()).toHaveLength(4);
    expect(photoButton().hasAttribute("disabled")).toBe(false);
  });

  it("화면을 떠나면 남은 미리보기 주소를 모두 해제한다", () => {
    const { unmount } = render(<Composer />);
    pick(photo("a.png"), photo("b.png"));

    unmount();

    expect(revoke).toHaveBeenCalledWith("blob:a.png");
    expect(revoke).toHaveBeenCalledWith("blob:b.png");
  });
});

describe("PhotoField (I01 · I01-B 사진)", () => {
  const addTile = () => screen.queryByRole("button", { name: "사진 추가" });

  it("안내 · 장수를 보여 주고, 고른 사진 칸 뒤에 '추가' 칸을 둔다", () => {
    render(<Field />);

    expect(screen.getByText("JPG · PNG, 5MB 이하 · 최대 5장")).toBeTruthy();
    expect(screen.getByText("0 / 5")).toBeTruthy();
    pick(photo("a.png"), photo("b.png"));

    expect(tiles()).toHaveLength(2);
    expect(screen.getByText("2 / 5")).toBeTruthy();
    expect(addTile()).toBeTruthy();
  });

  it("5장이면 '추가' 칸이 사라지고 남은 칸보다 많이 고르면 알리며, 빼면 다시 생긴다", () => {
    render(<Field />);

    pick(...["1", "2", "3", "4"].map((n) => photo(`${n}.png`)));
    pick(photo("5.png"), photo("6.png"));
    expect(tiles()).toHaveLength(5);
    expect(screen.getByRole("alert").textContent).toBe("사진은 5장까지 붙일 수 있습니다.");
    expect(addTile()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "사진 1 빼기" }));
    expect(revoke).toHaveBeenCalledWith("blob:1.png");
    expect(addTile()).toBeTruthy();
  });
});
