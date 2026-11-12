// @vitest-environment node
// 기준: 기획 메모 S06(18:757: 배경 씬은 페르소나별 — 커피챗 = 카페) · 사용자 결정(2026-10-26: 카페 실내 그림 1장을 화면에 채워 깔고,
// 이전 화면에서 미리 받는다. 못 받으면 배경 없이 그린다) · three.js 매뉴얼 How to dispose of objects
import { Color, Scene, SRGBColorSpace, Texture } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 경계 mock: 그림 풀기(three ImageLoader — 브라우저 그림 해석). 끝내는 때는 테스트가 정한다
type Decode = { done: (image: unknown) => void; fail: (error: unknown) => void };
const decodes = vi.hoisted(() => [] as Decode[]);
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  ImageLoader: class {
    load(_url: string, done: Decode["done"], _progress: unknown, fail: Decode["fail"]) {
      decodes.push({ done, fail });
    }
  },
}));

// 예시 데이터: 카페 배경 그림(1536×1024, 3:2)
const URL_CAFE = "/interview/coffee-chat/backdrop.webp";
const IMAGE = { width: 1536, height: 1024 };

/** 받기 · 그림 풀기 뒤에 이어진 Promise 처리(장면에 깔기)를 가짜 시계 한 번으로 모두 돌린다 */
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

async function load() {
  return import("./backdrop");
}

beforeEach(() => {
  vi.useFakeTimers();
  decodes.length = 0;
  vi.resetModules();
  // 경계 mock: 네트워크(fetch). 본문 스트림 없이 바로 끝나는 응답
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      body: null,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
  );
});

describe("setupBackdrop · 면접관 뒤 배경 그림", () => {
  describe("정상 처리", () => {
    it("다 받으면 그림을 장면 배경(sRGB)으로 두고 다시 그리게 알린다", async () => {
      const { setupBackdrop } = await load();
      const scene = new Scene();
      const onLoad = vi.fn();
      setupBackdrop({ scene, url: URL_CAFE, onLoad });
      await settle();

      decodes[0].done(IMAGE);
      await settle();

      const texture = scene.background as Texture;
      expect(texture.image).toBe(IMAGE);
      expect(texture.colorSpace).toBe(SRGBColorSpace);
      expect(onLoad).toHaveBeenCalledTimes(1);
    });
  });

  describe("상태 변화", () => {
    it.each([
      {
        label: "넓으면",
        cut: "위아래를",
        width: 1600,
        height: 800,
        repeat: [1, 0.75],
        offset: [0, 0.125],
      },
      {
        label: "좁으면",
        cut: "양옆을",
        width: 1024,
        height: 1024,
        repeat: [2 / 3, 1],
        offset: [1 / 6, 0],
      },
    ])(
      "화면이 그림보다 '$label' $cut 가운데 기준으로 잘라 채운다",
      async ({ width, height, repeat, offset }) => {
        const { setupBackdrop } = await load();
        const scene = new Scene();
        const backdrop = setupBackdrop({ scene, url: URL_CAFE, onLoad: vi.fn() });
        await settle();
        decodes[0].done(IMAGE);
        await settle();

        backdrop.resize(width, height);

        const texture = scene.background as Texture;
        expect(texture.repeat.x).toBeCloseTo(repeat[0]);
        expect(texture.repeat.y).toBeCloseTo(repeat[1]);
        expect(texture.offset.x).toBeCloseTo(offset[0]);
        expect(texture.offset.y).toBeCloseTo(offset[1]);
      },
    );

    it("받기 전에 화면 크기가 바뀌어도 받은 뒤 그 크기에 맞춘다", async () => {
      const { setupBackdrop } = await load();
      const scene = new Scene();
      const backdrop = setupBackdrop({ scene, url: URL_CAFE, onLoad: vi.fn() });
      backdrop.resize(1600, 800);
      await settle();

      decodes[0].done(IMAGE);
      await settle();

      const texture = scene.background as Texture;
      expect([texture.repeat.x, texture.repeat.y]).toEqual([1, 0.75]);
      expect([texture.offset.x, texture.offset.y]).toEqual([0, 0.125]);
    });
  });

  describe("경계값", () => {
    it("그림 크기를 모르면 자르지 않는다", async () => {
      const { setupBackdrop } = await load();
      const scene = new Scene();
      const backdrop = setupBackdrop({ scene, url: URL_CAFE, onLoad: vi.fn() });
      await settle();
      decodes[0].done({ width: 0, height: 0 });
      await settle();

      backdrop.resize(1600, 800);

      const texture = scene.background as Texture;
      expect([texture.repeat.x, texture.repeat.y]).toEqual([1, 1]);
      expect([texture.offset.x, texture.offset.y]).toEqual([0, 0]);
    });
  });

  describe("오류 처리", () => {
    it("그림을 받지 못하면 배경 없이 두고 다음에 부르면 다시 받는다", async () => {
      const { setupBackdrop } = await load();
      const scene = new Scene();
      const onLoad = vi.fn();
      setupBackdrop({ scene, url: URL_CAFE, onLoad });
      await settle();

      decodes[0].fail(new Error("decode"));
      await settle();
      expect(scene.background).toBeNull();
      expect(onLoad).not.toHaveBeenCalled();

      setupBackdrop({ scene, url: URL_CAFE, onLoad });
      await settle();
      expect(decodes).toHaveLength(2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("미리 받아 둔(받는 중인) 그림은 다시 받지 않고 쓴다", async () => {
      const { preloadBackdrop, setupBackdrop } = await load();
      const preloaded = preloadBackdrop(URL_CAFE);
      const scene = new Scene();
      setupBackdrop({ scene, url: URL_CAFE, onLoad: vi.fn() });
      await settle();

      decodes[0].done(IMAGE);
      await preloaded;
      await settle();

      expect(fetch).toHaveBeenCalledTimes(1);
      expect((scene.background as Texture).image).toBe(IMAGE);
    });

    it("다 받기 전에 정리하면 늦게 온 그림을 배경으로 두지 않고 알리지도 않는다", async () => {
      const { setupBackdrop } = await load();
      const scene = new Scene();
      const onLoad = vi.fn();
      const backdrop = setupBackdrop({ scene, url: URL_CAFE, onLoad });
      await settle();

      backdrop.dispose();
      decodes[0].done(IMAGE);
      await settle();

      expect(scene.background).toBeNull();
      expect(onLoad).not.toHaveBeenCalled();
    });
  });

  describe("정리", () => {
    it("정리하면 배경을 떼고 텍스처를 놓는다", async () => {
      const { setupBackdrop } = await load();
      const scene = new Scene();
      const backdrop = setupBackdrop({ scene, url: URL_CAFE, onLoad: vi.fn() });
      await settle();
      decodes[0].done(IMAGE);
      await settle();
      const dispose = vi.spyOn(scene.background as Texture, "dispose");

      backdrop.dispose();

      expect(scene.background).toBeNull();
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it.each([
      { label: "다 풀면", finish: (decode: Decode) => decode.done(IMAGE) },
      { label: "풀지 못해도", finish: (decode: Decode) => decode.fail(new Error("decode")) },
    ])("그림을 '$label' 임시 주소를 놓는다", async ({ finish }) => {
      const { setupBackdrop } = await load();
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      setupBackdrop({ scene: new Scene(), url: URL_CAFE, onLoad: vi.fn() });
      await settle();

      finish(decodes[0]);
      await settle();

      expect(revoke).toHaveBeenCalledTimes(1);
    });

    it("그사이 장면 배경이 다른 것으로 바뀌었으면 떼지 않는다", async () => {
      const { setupBackdrop } = await load();
      const scene = new Scene();
      const backdrop = setupBackdrop({ scene, url: URL_CAFE, onLoad: vi.fn() });
      await settle();
      decodes[0].done(IMAGE);
      await settle();
      const other = new Color(0x000000);
      scene.background = other;

      backdrop.dispose();

      expect(scene.background).toBe(other);
    });
  });
});
