// @vitest-environment node
import { Scene, SRGBColorSpace, Texture } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preloadBackdrop, setupBackdrop } from "./backdrop";

// 기준: 기획 메모 S06(18:757: 커피챗 = 카페) · 사용자 결정(2026-10-26: 카페 실내 그림 1장을 화면에 채워 깔고,
// 이전 화면에서 미리 받는다. 못 받으면 배경 없이 그린다)
// · 사용자 결정(2026-11-04: 배경도 받다가 멈추면 다시 받는다 — 멈춤 판단은 download.test.ts, 재시도 규칙은 retry.test.ts가 본다)
// 내려받기(fetch)는 바로 답하는 가짜로, 그림 풀기(ImageLoader)는 테스트가 끝내는 때를 정하는 가짜로 바꾼다.
// 받은 그림은 모듈이 주소별로 기억하므로 테스트마다 주소를 달리한다.

type Request = { url: string; done: (image: unknown) => void; fail: (error: unknown) => void };
const requests = vi.hoisted(() => [] as Request[]);
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  ImageLoader: class {
    load(url: string, done: Request["done"], _progress: unknown, fail: Request["fail"]) {
      requests.push({ url, done, fail });
    }
  },
}));

/** 1536×1024(3:2) 그림을 받은 것으로 친다 */
const IMAGE = { width: 1536, height: 1024 };
/** 남은 콜백(그림을 받은 뒤 장면에 까는 일)을 모두 끝낸다 */
const flush = () => new Promise((done) => setTimeout(done, 0));

/** 내려받은 주소(그림 풀기는 받은 내용의 임시 주소로 한다) */
const fetched = () => vi.mocked(fetch).mock.calls.map(([url]) => url);

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
  );
});

afterEach(() => {
  requests.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("setupBackdrop (면접관 뒤 배경 그림)", () => {
  it("다 받으면 그 그림을 장면 배경으로 두고(sRGB) 다시 그리게 알린다", async () => {
    const scene = new Scene();
    const onLoad = vi.fn();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    setupBackdrop({ scene, url: "a.webp", onLoad });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(fetched()).toEqual(["a.webp"]);
    expect(requests[0].url).toMatch(/^blob:/);
    expect(scene.background).toBeNull();

    requests[0].done(IMAGE);
    await flush();

    const texture = scene.background as Texture;
    expect(texture.image).toBe(IMAGE);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    expect(onLoad).toHaveBeenCalledTimes(1);
    // 그림을 다 풀면 임시 주소를 놓는다.
    expect(revoke).toHaveBeenCalledWith(requests[0].url);
  });

  it("화면이 그림보다 넓으면 위아래를, 좁으면 양옆을 가운데 기준으로 잘라 화면을 채운다", async () => {
    const scene = new Scene();
    const backdrop = setupBackdrop({ scene, url: "b.webp", onLoad: vi.fn() });
    backdrop.resize(1600, 800);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0].done(IMAGE);
    await flush();
    const texture = scene.background as Texture;

    // 2:1 화면에 3:2 그림: 세로의 0.75만 보이고 위아래를 0.125씩 같게 자른다.
    expect([texture.repeat.x, texture.repeat.y]).toEqual([1, 0.75]);
    expect([texture.offset.x, texture.offset.y]).toEqual([0, 0.125]);

    // 세로 화면(375×812)으로 바꾸면 가로만 자르고(가로의 약 30.8%) 위아래 자르기는 없어진다.
    backdrop.resize(375, 812);
    expect(texture.repeat.x).toBeCloseTo(0.30788, 4);
    expect(texture.repeat.y).toBe(1);
    expect(texture.offset.x).toBeCloseTo(0.34606, 4);
    expect(texture.offset.y).toBe(0);
  });

  it("정리하면 배경을 떼고 텍스처를 놓는다", async () => {
    const scene = new Scene();
    const backdrop = setupBackdrop({ scene, url: "c.webp", onLoad: vi.fn() });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0].done(IMAGE);
    await flush();
    const dispose = vi.spyOn(scene.background as Texture, "dispose");

    backdrop.dispose();

    expect(scene.background).toBeNull();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("다 받기 전에 정리하면, 늦게 온 그림은 배경으로 두지 않는다", async () => {
    const scene = new Scene();
    const onLoad = vi.fn();
    const backdrop = setupBackdrop({ scene, url: "d.webp", onLoad });

    backdrop.dispose();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0].done(IMAGE);
    await flush();

    expect(scene.background).toBeNull();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("미리 받아 둔 그림은 다시 받지 않고 바로 깐다", async () => {
    const preloaded = preloadBackdrop("e.webp");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0].done(IMAGE);
    await preloaded;

    const scene = new Scene();
    setupBackdrop({ scene, url: "e.webp", onLoad: vi.fn() });
    await flush();

    expect(fetched()).toEqual(["e.webp"]);
    expect(requests).toHaveLength(1);
    expect((scene.background as Texture).image).toBe(IMAGE);
  });

  it("그림을 풀지 못하면 배경 없이 두고, 다음에 부르면 다시 받는다", async () => {
    const preloaded = preloadBackdrop("f.webp");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    requests[0].fail(new Error("decode"));
    await expect(preloaded).rejects.toThrow("decode");

    const scene = new Scene();
    const onLoad = vi.fn();
    setupBackdrop({ scene, url: "f.webp", onLoad });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(fetched()).toEqual(["f.webp", "f.webp"]);
    requests[1].fail(new Error("decode"));
    await flush();

    expect(scene.background).toBeNull();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it("404는 다시 받지 않고 바로 실패한다", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 404 }));

    await expect(preloadBackdrop("g.webp")).rejects.toMatchObject({ status: 404 });

    expect(fetched()).toEqual(["g.webp"]);
    expect(requests).toHaveLength(0);
  });

  it("연결이 끊겨 실패하면(TypeError) 간격을 두고 다시 받는다", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const preloaded = preloadBackdrop("h.webp");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetched()).toEqual(["h.webp"]);
    // 첫 재시도 간격은 1초 + 무작위(최대 1초)라 2초를 넘기면 반드시 다시 받는다.
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetched()).toEqual(["h.webp", "h.webp"]);
    requests[0].done(IMAGE);

    await expect(preloaded).resolves.toBeUndefined();
  });
});
