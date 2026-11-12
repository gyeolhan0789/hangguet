// 기준: Swagger 9.11(JPG · PNG, 5MB 이하, 메시지당 5장) · 사용자 결정(2026-11-03: 첫 문의(I01 · I01-B)는 내용 아래 사진 칸(끝에 '추가' 칸),
// 이어서 쓰기(I03)는 입력 상자 안 사진 버튼 · 글 위 사진)
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ChangeEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PHOTO_COUNT } from "@/lib/inquiry/schemas";

import { PhotoComposer, PhotoField, usePhotoPicks } from "./photo-picker";

// 경계 mock: 미리보기 주소(URL.createObjectURL · revokeObjectURL)는 속성만 바꾼다(테스트마다 되돌아간다)
beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

// 예시 데이터: 고른 사진(크기는 내용 길이, 큰 사진만 크기를 바꾼다)
const photo = (name: string, type = "image/png") => new File([new Uint8Array(10)], name, { type });
const photos = (count: number) => Array.from({ length: count }, (_, i) => photo(`${i + 1}.png`));
function oversized(name: string) {
  const file = photo(name);
  Object.defineProperty(file, "size", { value: 5_242_881 });
  return file;
}

/** 파일 입력칸 onChange에 넘길 이벤트 */
const changeEvent = (files: File[], value = "C:\\fakepath\\a.png") =>
  ({ target: { files, value } }) as unknown as ChangeEvent<HTMLInputElement>;

/** 훅에서 파일을 고른다 */
function pickInHook(hook: { current: ReturnType<typeof usePhotoPicks> }, files: File[]) {
  act(() => hook.current.onInputChange(changeEvent(files)));
}

/** 화면에서 파일을 고른다 */
const pick = (files: File[]) =>
  fireEvent.change(screen.getByLabelText("사진 파일"), { target: { files } });
const tiles = () => screen.queryAllByRole("img", { name: /고른 사진/ });

function Field() {
  const picks = usePhotoPicks();
  return <PhotoField picks={picks} />;
}

function Composer({ disabled = false }: Readonly<{ disabled?: boolean }>) {
  const picks = usePhotoPicks();
  return (
    <PhotoComposer
      id="content"
      aria-label="이어서 쓰기"
      heightClass="h-14"
      picks={picks}
      disabled={disabled}
    />
  );
}

describe("usePhotoPicks · 고른 사진 목록", () => {
  describe("사용자 조작", () => {
    it("파일을 고른 뒤 입력칸 값을 비워 같은 파일을 다시 고를 수 있게 한다", () => {
      const { result } = renderHook(() => usePhotoPicks());
      const event = changeEvent([photo("a.png")]);

      act(() => result.current.onInputChange(event));

      expect(event.target.value).toBe("");
    });
  });

  describe("정상 처리", () => {
    it("규칙에 맞는 사진을 고르면 미리보기 주소와 함께 목록에 더한다", () => {
      const a = photo("a.png");
      const b = photo("b.jpg", "image/jpeg");
      const { result } = renderHook(() => usePhotoPicks());

      pickInHook(result, [a, b]);

      expect(result.current.photos.map(({ file, url }) => ({ file, url }))).toEqual([
        { file: a, url: "blob:a.png" },
        { file: b, url: "blob:b.jpg" },
      ]);
      expect(result.current.files).toEqual([a, b]);
    });
  });

  describe("상태 변화", () => {
    it("사진을 빼면 그 미리보기 주소를 해제하고 오류를 지운다", () => {
      const { result } = renderHook(() => usePhotoPicks());
      pickInHook(result, [photo("a.png"), photo("b.png"), photo("c.gif", "image/gif")]);

      act(() => result.current.remove(result.current.photos[0].id));

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:a.png");
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(result.current.photos.map(({ url }) => url)).toEqual(["blob:b.png"]);
      expect(result.current.error).toBeUndefined();
    });

    it("모두 비우면 미리보기 주소를 모두 해제하고 오류를 지운다", () => {
      const { result } = renderHook(() => usePhotoPicks());
      pickInHook(result, [photo("a.png"), photo("b.png"), photo("c.gif", "image/gif")]);

      act(() => result.current.clear());

      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([["blob:a.png"], ["blob:b.png"]]);
      expect(result.current.photos).toEqual([]);
      expect(result.current.error).toBeUndefined();
    });
  });

  describe("입력 검증", () => {
    it("규칙에 맞지 않는 사진은 빼고 첫 사유를 오류로 둔다", () => {
      const ok = photo("ok.png");
      const { result } = renderHook(() => usePhotoPicks());

      pickInHook(result, [photo("a.gif", "image/gif"), oversized("big.png"), ok]);

      expect(result.current.files).toEqual([ok]);
      expect(result.current.error).toBe("JPG·PNG만 올릴 수 있습니다.");
    });
  });

  describe("경계값", () => {
    it("남은 칸보다 많이 고르면 남은 칸만큼만 더하고 장수 문구를 오류로 둔다", () => {
      const { result } = renderHook(() => usePhotoPicks());
      pickInHook(result, photos(4));

      pickInHook(result, [photo("5.png"), photo("6.png")]);

      expect(result.current.photos.map(({ url }) => url)).toEqual([
        "blob:1.png",
        "blob:2.png",
        "blob:3.png",
        "blob:4.png",
        "blob:5.png",
      ]);
      expect(result.current.error).toBe(PHOTO_COUNT);
    });

    it("5장이면 가득 찼다고 알린다", () => {
      const { result } = renderHook(() => usePhotoPicks());
      pickInHook(result, photos(4));
      expect(result.current.full).toBe(false);

      pickInHook(result, [photo("5.png")]);

      expect(result.current.full).toBe(true);
    });
  });

  describe("정리", () => {
    it("언마운트하면 남은 미리보기 주소를 모두 해제한다", () => {
      const { result, unmount } = renderHook(() => usePhotoPicks());
      pickInHook(result, [photo("a.png"), photo("b.png")]);

      unmount();

      expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([["blob:a.png"], ["blob:b.png"]]);
    });
  });
});

describe("PhotoField · 첫 문의 사진 칸", () => {
  describe("화면 표시", () => {
    it("고른 장수를 'N / 5'로 보여 주고 고른 사진 뒤에 '추가' 칸을 둔다", () => {
      render(<Field />);

      pick(photos(2));

      expect(screen.getByText("2 / 5")).toBeDefined();
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(3);
      expect(items[2].contains(screen.getByRole("button", { name: "사진 추가" }))).toBe(true);
    });

    it("5장이면 '추가' 칸을 없앤다", () => {
      render(<Field />);

      pick(photos(5));

      expect(tiles()).toHaveLength(5);
      expect(screen.queryByRole("button", { name: "사진 추가" })).toBeNull();
    });

    it("사진 오류가 있으면 알림 문구로 보여 준다", () => {
      render(<Field />);

      pick([photo("a.gif", "image/gif")]);

      expect(screen.getByRole("alert").textContent).toBe("JPG·PNG만 올릴 수 있습니다.");
    });
  });

  describe("사용자 조작", () => {
    it("'추가' 칸을 누르면 파일 고르기를 연다", () => {
      const openPicker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
      render(<Field />);

      fireEvent.click(screen.getByRole("button", { name: "사진 추가" }));

      expect(openPicker).toHaveBeenCalledTimes(1);
      expect(openPicker.mock.contexts[0]).toBe(screen.getByLabelText("사진 파일"));
    });
  });
});

describe("PhotoComposer · 이어서 쓰기 입력 상자", () => {
  describe("화면 표시", () => {
    it("사진을 고르기 전에는 사진 칸 없이 안내 문구를 보여 준다", () => {
      render(<Composer />);

      expect(screen.queryByRole("list", { name: "고른 사진" })).toBeNull();
      expect(screen.getByText("JPG · PNG, 5MB 이하 · 최대 5장")).toBeDefined();
    });

    it("사진을 고르면 글 위에 사진을 보여 주고 'N / 5'를 보여 준다", () => {
      render(<Composer />);

      pick(photos(2));

      const list = screen.getByRole("list", { name: "고른 사진" });
      const textarea = screen.getByRole("textbox", { name: "이어서 쓰기" });
      expect(tiles()).toHaveLength(2);
      expect(list.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(screen.getByText("사진 2 / 5")).toBeDefined();
    });

    it("5장이면 사진 버튼을 누를 수 없다", () => {
      render(<Composer />);

      pick(photos(5));

      expect(screen.getByRole("button", { name: "사진 붙이기" }).hasAttribute("disabled")).toBe(
        true,
      );
    });

    it("보내는 중이면 사진 버튼을 누를 수 없다", () => {
      render(<Composer disabled />);

      expect(screen.getByRole("button", { name: "사진 붙이기" }).hasAttribute("disabled")).toBe(
        true,
      );
    });
  });

  describe("사용자 조작", () => {
    it("사진의 빼기 버튼을 누르면 그 사진을 뺀다", () => {
      render(<Composer />);
      pick([photo("a.png"), photo("b.png")]);

      fireEvent.click(screen.getByRole("button", { name: "사진 1 빼기" }));

      expect(tiles()).toHaveLength(1);
    });
  });
});
