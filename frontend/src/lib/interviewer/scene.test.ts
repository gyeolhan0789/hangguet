// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web app.js: 조명 · 표정 · 자세 진행도) · 면접관 표현 결정 ③-3(실패 시 정지 이미지)
// · 사용자 요청(2026-10-21: S05부터 모델을 미리 불러오기) · 사용자 결정(2026-11-04: 진행률은 모델 원본 크기 기준)
// · three.js 매뉴얼 How to dispose of objects · WebGLRenderer.setAnimationLoop
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "@/test/deferred";

import type { FaceRules } from "./face-rules";
import type { InterviewerModel, SceneLights } from "./scene";

// 경계 mock: WebGL(WebGLRenderer — 그리기 · 크기 · 루프를 기록), 모델 해석(GLTFLoader · meshopt), 폭풍 배경(WebGL 후처리)
type FrameLoop = ((now: number) => void) | null;
const renderers = vi.hoisted(
  () =>
    [] as {
      shadowMap: { enabled: boolean; type: number };
      loop: FrameLoop;
      setPixelRatio: ReturnType<typeof vi.fn>;
      setSize: ReturnType<typeof vi.fn>;
      render: ReturnType<typeof vi.fn>;
      setAnimationLoop: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      forceContextLoss: ReturnType<typeof vi.fn>;
    }[],
);
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: class {
    shadowMap = { enabled: false, type: 0 };
    loop: FrameLoop = null;
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    setAnimationLoop = vi.fn((loop: FrameLoop) => {
      this.loop = loop;
    });
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    constructor() {
      renderers.push(this);
    }
  },
}));
const gltf = vi.hoisted(() => ({ parseAsync: vi.fn() }));
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
    parseAsync(data: ArrayBuffer, path: string) {
      return gltf.parseAsync(data, path);
    }
  },
}));
vi.mock("three/addons/libs/meshopt_decoder.module.js", () => ({ MeshoptDecoder: {} }));
const storm = vi.hoisted(() => ({ setupStorm: vi.fn() }));
vi.mock("./storm", () => storm);
// 경계 mock: 배경 그림(그림 받기 · 풀기). 다 받았다는 알림(onLoad)은 테스트가 부른다
const backdrop = vi.hoisted(() => ({ setupBackdrop: vi.fn() }));
vi.mock("./backdrop", () => backdrop);

// 예시 데이터: 면접관 모델 묶음(models.ts와 같은 모양, 원본 크기는 100바이트로 줄임)
const STATIC_MODEL: InterviewerModel = {
  glb: "/interview/devil/interviewer.glb",
  glbBytes: 100,
  faceRules: "/interview/devil/face-rules.json",
  staticPose: true,
};
const POSE_MODEL: InterviewerModel = {
  glb: "/interview/coffee-chat/interviewer.glb",
  glbBytes: 100,
  faceRules: "/interview/coffee-chat/face-rules.json",
  animation: "/interview/coffee-chat/animation.json",
};
const CLIP_MODEL: InterviewerModel = {
  glb: "/interview/duck/interviewer.glb",
  glbBytes: 100,
  faceRules: "/interview/duck/face-rules.json",
  clips: { idle: "Duck_Idle", nod: "Duck_Nod", talk: "Duck_Talk", surprise: "Duck_Surprise" },
};
const FRAME = {
  position: [0, 1, 2] as [number, number, number],
  target: [0, 1, 0] as [number, number, number],
  fov: 34,
};
/** 표정 규칙: Face_Main 메시의 Smile · A · I 셰이프 키가 같은 이름의 조절 값을 그대로 따른다 */
const RULES: FaceRules = {
  defaults: { A: 0, I: 0, U: 0, E: 0, O: 0, Blink: 0 },
  rules: {
    Face_Main: {
      Smile: { expr: ["v", "x"], vars: { x: ["control", "Smile"] } },
      A: { expr: ["v", "x"], vars: { x: ["control", "A"] } },
      I: { expr: ["v", "x"], vars: { x: ["control", "I"] } },
    },
  },
};
/** 자세 구간: 읽는 자세는 rest-read 구간(0.2~0.6초)의 절반 지점(0.4초) */
const POSE = {
  poses: ["read", "rest", "tilt"],
  segments: { "rest-read": { start: 0.2, end: 0.6, seconds: 1 } },
  poseEndpoints: { read: ["rest-read", 0.5], rest: ["rest-read", 0], tilt: ["rest-read", 1] },
};
const SHADOW_LIGHTS = (lights: SceneLights): SceneLights => ({
  ...lights,
  shadow: { color: 0x4a2810, opacity: 0.45 },
});

let three: typeof import("three");
let sceneModule: typeof import("./scene");
let files: Record<string, () => Promise<Response>>;

/** 면접관 모델(GLTF). 몸(스킨 메시) · 소품 · WEB-face-main 아래 표정 메시 · 머리 뼈대 · 자세 동작이 든다 */
function interviewer() {
  const root = new three.Group();
  const body = new three.Mesh(new three.BoxGeometry());
  body.name = "Body";
  (body as unknown as { isSkinnedMesh: boolean }).isSkinnedMesh = true;
  const desk = new three.Mesh(new three.BoxGeometry());
  desk.name = "Desk";
  const head = new three.Bone();
  head.name = "Head";
  head.rotation.x = 0.2;
  const faceGroup = new three.Group();
  faceGroup.name = "WEB-face-main";
  const geometry = new three.BufferGeometry();
  geometry.setAttribute(
    "position",
    new three.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geometry.setAttribute(
    "normal",
    new three.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  const face = new three.Mesh(geometry);
  face.morphTargetDictionary = { Smile: 0, A: 1, I: 2 };
  face.morphTargetInfluences = [0, 0, 0];
  faceGroup.position.set(0, 1.5, 0);
  faceGroup.add(face);
  root.add(body, desk, head, faceGroup);
  const track = (name: string, seconds: number) =>
    new three.AnimationClip(name, seconds, [
      new three.VectorKeyframeTrack("Body.position", [0, seconds], [0, 0, 0, 1, 0, 0]),
    ]);
  const animations = [
    track("Pose", 1),
    track("Duck_Idle", 1),
    track("Duck_Nod", 0.5),
    track("Duck_Talk", 1),
    track("Duck_Surprise", 0.5),
  ];
  return { scene: root, animations, body, desk, head, face };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: height, configurable: true });
  return canvas;
}

function open(options: Partial<Parameters<typeof sceneModule.createInterviewerScene>[0]> = {}) {
  return sceneModule.createInterviewerScene({
    canvas: canvasOf(800, 600),
    model: STATIC_MODEL,
    frame: FRAME,
    onLost: vi.fn(),
    signal: new AbortController().signal,
    ...options,
  });
}

const renderer = () => renderers.at(-1)!;
/** 그리기 루프의 한 프레임 */
function frame() {
  renderer().loop!(performance.now());
}
/** 받은 횟수(주소별) */
function fetched(url?: string) {
  const calls = vi.mocked(fetch).mock.calls.map(([target]) => String(target));
  return url ? calls.filter((target) => target === url).length : calls.length;
}

/** 내용을 조각으로 나눠 보내는 응답(gzip 응답처럼 Content-Length 없이) */
function chunked(...sizes: number[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        sizes.forEach((size) => controller.enqueue(new Uint8Array(size)));
        controller.close();
      },
    }),
  );
}

beforeEach(async () => {
  renderers.length = 0;
  vi.resetModules();
  three = await import("three");
  sceneModule = await import("./scene");
  const model = interviewer();
  gltf.parseAsync.mockResolvedValue(model);
  files = {
    [STATIC_MODEL.glb]: async () => new Response(new Uint8Array(100)),
    [POSE_MODEL.glb]: async () => new Response(new Uint8Array(100)),
    [CLIP_MODEL.glb]: async () => new Response(new Uint8Array(100)),
    [STATIC_MODEL.faceRules]: async () => new Response(JSON.stringify(RULES)),
    [POSE_MODEL.faceRules]: async () => new Response(JSON.stringify(RULES)),
    [CLIP_MODEL.faceRules]: async () => new Response(JSON.stringify(RULES)),
    [POSE_MODEL.animation!]: async () => new Response(JSON.stringify(POSE)),
  };
  // 경계 mock: 네트워크(fetch). 주소별 응답은 테스트가 바꾼다
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => files[url]?.() ?? Promise.resolve(new Response("", { status: 404 }))),
  );
  backdrop.setupBackdrop.mockReturnValue({ resize: vi.fn(), dispose: vi.fn() });
  storm.setupStorm.mockReturnValue({
    update: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  });
});

describe("preloadInterviewerAssets · 면접관 모델 미리 불러오기", () => {
  describe("정상 처리", () => {
    it("자세 구간이 없는 모델은 자세 파일을 받지 않는다", async () => {
      await sceneModule.preloadInterviewerAssets(STATIC_MODEL);

      expect(fetched()).toBe(2);
    });
  });

  describe("경계값", () => {
    it("전체 크기를 알려 주지 않는 응답도 모델 원본 크기 기준으로 받은 비율을 알린다", async () => {
      files[POSE_MODEL.glb] = async () => chunked(25, 50, 25);
      const progress = vi.fn();

      await sceneModule.preloadInterviewerAssets(POSE_MODEL, progress);

      expect(progress.mock.calls).toEqual([[0.25], [0.75], [1]]);
    });

    it("받은 양이 원본 크기보다 커도 비율은 1을 넘지 않는다", async () => {
      files[POSE_MODEL.glb] = async () => chunked(80, 40);
      const progress = vi.fn();

      await sceneModule.preloadInterviewerAssets(POSE_MODEL, progress);

      expect(progress.mock.calls).toEqual([[0.8], [1]]);
    });
  });

  describe("오류 처리", () => {
    it("실패하면 목록에서 지워 다음에 부르면 처음부터 다시 받는다", async () => {
      const rules = files[POSE_MODEL.faceRules];
      files[POSE_MODEL.faceRules] = async () => new Response("", { status: 404 });
      await expect(sceneModule.preloadInterviewerAssets(POSE_MODEL)).rejects.toMatchObject({
        status: 404,
      });

      files[POSE_MODEL.faceRules] = rules;
      await sceneModule.preloadInterviewerAssets(POSE_MODEL);

      expect(fetched(POSE_MODEL.glb)).toBe(2);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("불러오는 중이거나 다 불러온 모델을 다시 부르면 또 받지 않는다", async () => {
      const loading = sceneModule.preloadInterviewerAssets(POSE_MODEL);
      const again = sceneModule.preloadInterviewerAssets(POSE_MODEL);
      await Promise.all([loading, again]);

      await sceneModule.preloadInterviewerAssets(POSE_MODEL);

      expect(fetched()).toBe(3);
      expect(gltf.parseAsync).toHaveBeenCalledTimes(1);
    });

    it("장면이 꺼내 간 뒤 새로 받는 중이면 앞선 받기가 늦게 실패해도 새 받기를 지우지 않는다", async () => {
      const first = deferred<Response>();
      files[STATIC_MODEL.glb] = () => first.promise;
      void sceneModule.preloadInterviewerAssets(STATIC_MODEL).catch(() => {});
      const taken = open();
      files[STATIC_MODEL.glb] = async () => new Response(new Uint8Array(100));
      const second = sceneModule.preloadInterviewerAssets(STATIC_MODEL);

      first.resolve(new Response("", { status: 404 }));
      await expect(taken).rejects.toMatchObject({ status: 404 });
      await second;
      await sceneModule.preloadInterviewerAssets(STATIC_MODEL);

      expect(fetched(STATIC_MODEL.glb)).toBe(2);
    });
  });
});

describe("createInterviewerScene · 면접관 장면", () => {
  describe("정상 처리", () => {
    it("미리 불러 둔 모델을 꺼내 쓰고 다시 받지 않는다", async () => {
      await sceneModule.preloadInterviewerAssets(STATIC_MODEL);

      const scene = await open();

      expect(fetched()).toBe(2);
      expect(gltf.parseAsync).toHaveBeenCalledTimes(1);
      scene.dispose();
    });

    it("자세 면접관은 읽는 자세 구간의 진행도 시점에 자세를 멈춘다", async () => {
      const model = interviewer();
      model.animations = [model.animations[0]];
      gltf.parseAsync.mockResolvedValue(model);

      const scene = await open({ model: POSE_MODEL });

      expect(model.body.position.x).toBeCloseTo(0.4);
      scene.dispose();
    });

    it("표정 규칙의 메시 이름과 구분자 · 대소문자가 달라도 WEB_이름 아래 메시를 찾아 표정을 넣는다", async () => {
      const model = interviewer();
      gltf.parseAsync.mockResolvedValue(model);
      const scene = await open();

      scene.setFace({ emotion: "Smile", emotionWeight: 0.8 });
      frame();

      expect(model.face.morphTargetInfluences).toEqual([0.8, 0, 0]);
      scene.dispose();
    });

    it("그림자를 쓰면 소품만 그림자를 받고 면접관 몸(스킨 메시)은 받지 않는다", async () => {
      const model = interviewer();
      gltf.parseAsync.mockResolvedValue(model);

      const scene = await open({ lights: SHADOW_LIGHTS(sceneModule.DEFAULT_LIGHTS) });

      expect(renderer().shadowMap.enabled).toBe(true);
      expect(model.desk.receiveShadow).toBe(true);
      expect(model.body.receiveShadow).toBe(false);
      scene.dispose();
    });

    it("얼굴 조명은 표정 메시를 감싼 상자의 가운데를 겨눈다", async () => {
      // 커피챗 조명처럼 그림자와 얼굴 조명을 함께 쓴다
      const lights = {
        ...SHADOW_LIGHTS(sceneModule.DEFAULT_LIGHTS),
        face: { color: 0xffe2c4, intensity: 3, position: [0, 0.5, 2] as [number, number, number] },
      };
      const scene = await open({ lights });
      frame();

      const drawn = renderer().render.mock.calls[0][0] as import("three").Scene;
      const spot = drawn.children.find(
        (object) => (object as import("three").SpotLight).isSpotLight,
      ) as import("three").SpotLight | undefined;
      // 표정 메시: (0, 1.5, 0)에 놓인 한 변 1인 직각삼각형
      expect(spot?.target.position.toArray()).toEqual([0.5, 2, 0]);
      scene.dispose();
    });

    it("폭풍 배경이면 그림자 · 얼굴 조명 · 배경 그림을 쓰지 않는다", async () => {
      const lights = {
        ...SHADOW_LIGHTS(sceneModule.DEFAULT_LIGHTS),
        face: { color: 0xffe2c4, intensity: 3, position: [0, 0.5, 2] as [number, number, number] },
      };

      const scene = await open({
        lights,
        background: "/interview/coffee-chat/cafe.webp",
        storm: "/interview/devil/storm.mp4",
      });

      const drawn = storm.setupStorm.mock.calls[0][0].scene as import("three").Scene;
      expect(renderer().shadowMap.enabled).toBe(false);
      expect(
        drawn.children.some((object) => (object as import("three").SpotLight).isSpotLight),
      ).toBe(false);
      expect(backdrop.setupBackdrop).not.toHaveBeenCalled();
      scene.dispose();
    });

    it("폭풍 배경이면 매 프레임 폭풍으로 그린다", async () => {
      const scene = await open({ storm: "/interview/devil/storm.mp4" });
      const effect = storm.setupStorm.mock.results[0].value as { render: ReturnType<typeof vi.fn> };

      frame();
      frame();

      expect(effect.render).toHaveBeenCalledTimes(2);
      expect(renderer().render).not.toHaveBeenCalled();
      scene.dispose();
    });
  });

  describe("상태 변화", () => {
    it("표정이나 크기가 바뀐 프레임에만 다시 그린다", async () => {
      const scene = await open();
      frame();
      frame();
      expect(renderer().render).toHaveBeenCalledTimes(1);

      scene.setFace({ blink: 1 });
      frame();
      expect(renderer().render).toHaveBeenCalledTimes(2);

      scene.resize();
      frame();
      expect(renderer().render).toHaveBeenCalledTimes(3);
      scene.dispose();
    });

    it("입 모양 일부만 바꿔도 나머지 모음과 표정은 그대로 둔다", async () => {
      const model = interviewer();
      gltf.parseAsync.mockResolvedValue(model);
      const scene = await open();
      scene.setFace({
        emotion: "Smile",
        emotionWeight: 0.8,
        mouth: { A: 0.5, I: 0, U: 0, E: 0, O: 0 },
      });

      scene.setFace({ mouth: { I: 0.3 } as never });
      frame();

      expect(model.face.morphTargetInfluences).toEqual([0.8, 0.5, 0.3]);
      scene.dispose();
    });

    it("동작 클립이 움직이는 동안은 매 프레임 다시 그린다", async () => {
      const scene = await open({ model: CLIP_MODEL });
      scene.setTalking(true);

      frame();
      frame();
      frame();

      expect(renderer().render).toHaveBeenCalledTimes(3);
      scene.dispose();
    });

    it("그림자를 쓰면 첫 프레임을 한 번 더 그린다", async () => {
      const scene = await open({ lights: SHADOW_LIGHTS(sceneModule.DEFAULT_LIGHTS) });

      frame();
      frame();
      frame();

      expect(renderer().render).toHaveBeenCalledTimes(2);
      scene.dispose();
    });

    it.each([
      { label: "가로로 긴", width: 800, height: 600, fov: 34 },
      { label: "정사각", width: 600, height: 600, fov: 34 },
      // 세로 1:2 — 2 × atan(tan 17° × 2) ≈ 62.9°(손으로 구한 값)
      { label: "세로로 긴(1:2)", width: 400, height: 800, fov: 62.9 },
    ])("'$label' 화면이면 세로 화각을 $fov도로 둔다", async ({ width, height, fov }) => {
      const scene = await open({ canvas: canvasOf(width, height) });
      frame();

      const camera = renderer().render.mock.calls[0][1] as import("three").PerspectiveCamera;
      expect(camera.fov).toBeCloseTo(fov, 1);
      scene.dispose();
    });

    it("고개를 돌리면 다음 프레임을 다시 그린다", async () => {
      const scene = await open({ headBone: "Head" });
      frame();

      scene.setHead(0.1, 0);
      frame();

      expect(renderer().render).toHaveBeenCalledTimes(2);
      scene.dispose();
    });

    it("배경 그림을 다 받으면 다시 그린다", async () => {
      const scene = await open({ background: "/interview/coffee-chat/cafe.webp" });
      frame();
      frame();
      const { onLoad } = backdrop.setupBackdrop.mock.calls[0][0] as { onLoad: () => void };

      onLoad();
      frame();

      expect(renderer().render).toHaveBeenCalledTimes(2);
      scene.dispose();
    });
  });

  describe("경계값", () => {
    it("캔버스 크기가 0이면 크기를 맞추지 않는다", async () => {
      const scene = await open({ canvas: canvasOf(0, 0) });

      expect(renderer().setSize).not.toHaveBeenCalled();
      scene.dispose();
    });
  });

  describe("오류 처리", () => {
    it.each([
      {
        label: "자세 구간 없음",
        pose: "null",
        animations: undefined,
        message: "모델에 자세 구간이 없다",
      },
      {
        label: "동작 없음",
        pose: JSON.stringify(POSE),
        animations: [],
        message: "모델에 동작이 없다",
      },
    ])(
      "자세 모델에 '$label'이면 장면을 만들지 않고 실패한다",
      async ({ pose, animations, message }) => {
        files[POSE_MODEL.animation!] = async () => new Response(pose);
        const model = interviewer();
        if (animations) model.animations = animations;
        gltf.parseAsync.mockResolvedValue(model);

        await expect(open({ model: POSE_MODEL })).rejects.toThrow(message);
        expect(renderer().loop).toBeNull();
      },
    );

    it("실패하면 그때까지 만든 자원을 놓는다", async () => {
      files[POSE_MODEL.animation!] = async () => new Response("null");

      await expect(open({ model: POSE_MODEL })).rejects.toThrow();

      expect(renderer().dispose).toHaveBeenCalledTimes(1);
      expect(renderer().forceContextLoss).toHaveBeenCalledTimes(1);
    });

    it("그리던 중 WebGL 컨텍스트를 잃으면 기본 처리를 막고 onLost를 부른다", async () => {
      const canvas = canvasOf(800, 600);
      const onLost = vi.fn();
      const scene = await open({ canvas, onLost });
      const lost = new Event("webglcontextlost", { cancelable: true });

      canvas.dispatchEvent(lost);

      expect(lost.defaultPrevented).toBe(true);
      expect(onLost).toHaveBeenCalledTimes(1);
      scene.dispose();
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("다 받기 전에 화면을 떠나면 장면을 만들지 않고 받은 모델은 되돌려 둔다", async () => {
      const model = deferred<Response>();
      files[STATIC_MODEL.glb] = () => model.promise;
      const leave = new AbortController();
      const first = open({ signal: leave.signal });

      leave.abort();
      model.resolve(new Response(new Uint8Array(100)));
      await expect(first).rejects.toThrow();
      expect(renderer().loop).toBeNull();

      const next = await open();
      expect(fetched(STATIC_MODEL.glb)).toBe(1);
      next.dispose();
    });
  });

  describe("정리", () => {
    it("정리하면 그리기를 멈추고 컨텍스트를 놓으며 모델을 되돌려 다음 장면이 다시 받지 않는다", async () => {
      const scene = await open();
      const first = renderer();

      scene.dispose();

      expect(first.loop).toBeNull();
      expect(first.dispose).toHaveBeenCalledTimes(1);
      expect(first.forceContextLoss).toHaveBeenCalledTimes(1);
      const next = await open();
      expect(fetched(STATIC_MODEL.glb)).toBe(1);
      next.dispose();
    });

    it("정리하면 형상 · 재질 · 텍스처 · 폭풍 배경을 놓고 컨텍스트 손실 감시를 뗀다", async () => {
      const model = interviewer();
      const texture = new three.Texture();
      const material = model.desk.material as import("three").MeshBasicMaterial;
      material.map = texture;
      gltf.parseAsync.mockResolvedValue(model);
      const geometryDispose = vi.spyOn(model.desk.geometry, "dispose");
      const materialDispose = vi.spyOn(material, "dispose");
      const textureDispose = vi.spyOn(texture, "dispose");
      const canvas = canvasOf(800, 600);
      const onLost = vi.fn();
      const scene = await open({ canvas, onLost, storm: "/interview/devil/storm.mp4" });
      const effect = storm.setupStorm.mock.results[0].value as {
        dispose: ReturnType<typeof vi.fn>;
      };

      scene.dispose();
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));

      expect(geometryDispose).toHaveBeenCalledTimes(1);
      expect(materialDispose).toHaveBeenCalledTimes(1);
      expect(textureDispose).toHaveBeenCalledTimes(1);
      expect(effect.dispose).toHaveBeenCalledTimes(1);
      expect(onLost).not.toHaveBeenCalled();
    });

    it("고정 자세에서 고개를 돌린 채 정리해도 되돌린 모델은 원래 자세다", async () => {
      const model = interviewer();
      gltf.parseAsync.mockResolvedValue(model);
      const rest = model.head.quaternion.clone();
      const scene = await open({ headBone: "Head" });
      scene.setHead(0.1, 0.1);

      scene.dispose();

      expect(model.head.quaternion.angleTo(rest)).toBeCloseTo(0, 6);
    });
  });
});
