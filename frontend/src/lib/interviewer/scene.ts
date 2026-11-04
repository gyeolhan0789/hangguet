import {
  AnimationClip,
  AnimationMixer,
  Box3,
  DirectionalLight,
  HemisphereLight,
  LoaderUtils,
  LoopOnce,
  MathUtils,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SpotLight,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import { setupBackdrop, type Backdrop } from "./backdrop";
import { download } from "./download";
import { faceWeights, NEUTRAL_FACE, type FaceControls, type FaceRules } from "./face-rules";
import { createFaceSurface } from "./face-surface";
import { withRetry } from "./retry";
import { createHeadControl } from "./head";
import { setupStorm, type Storm } from "./storm";

// 면접관 3D 장면(three.js). 모델 · 표정 규칙 · 자세 구간을 불러와 캔버스에 그린다. 화면(React)과 따로 두어 브라우저에서만 불러온다.
// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web app.js: 조명 · 톤 매핑 · 표정 · 자세 진행도 · 최종 검증 FINAL_PREVIEW_REPORT.json)
// · 면접관 표현 모듈 결정 ③-3(박연수/interviewer-avatar decisions.md: 렌더 크기 = 표시 크기 × 기기 배율, 실패 시 정지 이미지)
// · 사용자 결정(2026-10-22: 모델 받기는 시간 제한 없이 상태로 판단, 실패 상태에 따라 자동 재시도
//   → 2026-11-04: 받는 도중 멈추면 다시 받기, 진행률은 모델 원본 크기 기준 — download.ts)
// · 사용자 요청(2026-10-22: 승인된 three_pose_final/web의 모델 · 표정 규칙 · 세 자세/여섯 전환 데이터로 교체)
// · three.js 매뉴얼 How to dispose of objects · WebGLRenderer.setAnimationLoop(정리할 때 루프를 멈춘 뒤 dispose)

/** 모델 파일 묶음 */
export interface InterviewerModel {
  /** 몸 · 얼굴 · 책상 · 의자 · 종이가 든 GLB(meshopt 압축) */
  glb: string;
  /** GLB 원본 크기(바이트). 받은 비율을 셀 때 쓴다(models.test.ts가 실제 파일 크기와 같은지 본다) */
  glbBytes: number;
  /** 표정 규칙(face-rules.json) */
  faceRules: string;
  /** 자세 전환 구간(animation.json) */
  animation: string;
}

interface PoseSegments {
  poses: ("read" | "rest" | "tilt")[];
  segments: Record<string, { start: number; end: number; seconds: number }>;
  poseEndpoints: Record<"read" | "rest" | "tilt", [string, number]>;
}

/** 카메라 위치 · 바라보는 점(모델 좌표, 미터) */
export interface CameraFrame {
  position: [number, number, number];
  target: [number, number, number];
  /** 세로 화각(도) */
  fov: number;
}

type Vec3 = [number, number, number];

/** 조명(색은 16진 RGB). 면접관마다 배경에 맞춰 바꿀 수 있다. 폭풍 배경은 이 조명(노출 포함)을 자기 값으로 덮어쓰고 번개에 맞춰 깜빡인다. */
export interface SceneLights {
  /** 톤 매핑 노출 */
  exposure: number;
  /** 하늘 · 바닥 반사광 */
  hemi: { sky: number; ground: number; intensity: number };
  /** 주광 */
  key: { color: number; intensity: number; position: Vec3 };
  /** 보조광 */
  fill: { color: number; intensity: number; position: Vec3 };
  /**
   * 주광 그림자. 주면 면접관 · 소품끼리 그림자를 드리우고, 모델 바닥 높이에 그림자만 받는 투명한 바닥을 깔아
   * 배경 그림의 바닥 위에 그림자가 떨어진다(three.js ShadowMaterial). 폭풍 배경에서는 쓰지 않는다.
   */
  shadow?: { color: number; opacity: number };
  /** 얼굴만 비추는 부드러운 스포트라이트(얼굴 메시 가운데를 겨누고 얼굴 크기만큼만 퍼진다). 폭풍 배경에서는 쓰지 않는다. */
  face?: { color: number; intensity: number; position: Vec3 };
}

/** 기본 조명(면접관 3D 모델 웹 미리보기와 같은 값) */
export const DEFAULT_LIGHTS: SceneLights = {
  exposure: 1.2,
  hemi: { sky: 0xdde9ff, ground: 0x504033, intensity: 2.4 },
  key: { color: 0xffe4c6, intensity: 3, position: [-1.2, 2, 2] },
  fill: { color: 0xb8d2ff, intensity: 1.3, position: [1.8, 1, -1] },
};

export interface InterviewerScene {
  setHead: (pitch: number, roll: number) => void;
  /** 표정을 바꾼다. 다음 프레임에 그린다. */
  setFace: (face: Partial<FaceControls>) => void;
  /** 화면 크기가 바뀌었을 때 캔버스 크기에 맞춘다. */
  resize: () => void;
  /** 그리기를 멈추고 GPU 자원을 모두 놓는다. */
  dispose: () => void;
}

interface InterviewerAssets {
  gltf: GLTF;
  rules: FaceRules;
  pose: PoseSegments;
}

/** 미리 불러 둔 모델(GLB 주소 → 불러오는 중이거나 다 불러온 결과). 장면을 만들 때 꺼내 쓰고 지운다. */
const preloaded = new Map<string, Promise<InterviewerAssets>>();

/** 받은 비율(0~1)을 알려 준다. 모델 GLB가 대부분이라 GLB 기준으로 센다 */
export type LoadProgress = (ratio: number) => void;

/**
 * 모델 · 표정 규칙 · 자세 구간을 내려받아 해석한다(meshopt 압축 풀기 포함).
 * 파일마다 실패 상태에 따라 다시 받는다(withRetry: 오프라인이면 다시 연결될 때까지 기다리고, 네트워크 오류 · 5xx · 받다가 멈춤은 최대 5번).
 * 받은 비율은 모델 원본 크기(glbBytes) 기준이다. gzip 응답은 전체 크기를 알려 주지 않기 때문이다.
 */
function loadAssets(
  model: InterviewerModel,
  onProgress?: LoadProgress,
): Promise<InterviewerAssets> {
  const fetchJson = <T>(url: string) =>
    withRetry(() => download(url)).then(
      (buffer) => JSON.parse(new TextDecoder().decode(buffer)) as T,
    );
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return Promise.all([
    withRetry(() =>
      download(model.glb, (bytes) => onProgress?.(Math.min(1, bytes / model.glbBytes))),
    ).then((buffer) => loader.parseAsync(buffer, LoaderUtils.extractUrlBase(model.glb))),
    fetchJson<FaceRules>(model.faceRules),
    fetchJson<PoseSegments>(model.animation),
  ]).then(([gltf, rules, pose]) => ({ gltf, rules, pose }));
}

/**
 * 면접 화면에 오기 전(S05 장치 점검)에 모델을 미리 내려받아 해석해 둔다. 이미 불러오는 중이면 그 결과를 함께 기다린다.
 * 화면 사이 이동(클라이언트 이동)에서는 이 결과가 남아 있어, 면접 화면은 GPU에 올려 그리기만 하면 된다.
 * 다 받으면 끝나고, 다시 해도 안 되면 실패로 끝난다(이때 목록에서 지워 다음에 처음부터 다시 받게 한다).
 */
export function preloadInterviewerAssets(
  model: InterviewerModel,
  onProgress?: LoadProgress,
): Promise<void> {
  let loading = preloaded.get(model.glb);
  if (!loading) {
    loading = loadAssets(model, onProgress);
    preloaded.set(model.glb, loading);
    loading.catch(() => {
      if (preloaded.get(model.glb) === loading) preloaded.delete(model.glb);
    });
  }
  return loading.then(() => undefined);
}

/** 미리 불러 둔 모델을 꺼낸다(한 장면에서만 쓴다). 없으면 지금 불러온다. */
function takeAssets(model: InterviewerModel): Promise<InterviewerAssets> {
  const loading = preloaded.get(model.glb);
  preloaded.delete(model.glb);
  return loading ?? loadAssets(model);
}

/** 꺼냈지만 장면에 쓰지 않은 모델을 되돌려 둔다(다음 장면이 다시 받지 않고 쓴다). */
function returnAssets(model: InterviewerModel, assets: InterviewerAssets) {
  if (!preloaded.has(model.glb)) preloaded.set(model.glb, Promise.resolve(assets));
}

/** SkinnedMesh를 값으로 불러오지 않고 구분한다 */
type SkinnedMeshLike = Mesh & { isSkinnedMesh?: boolean };

/** 렌더 배율 상한(미리보기 검증값 1.5: 평균 프레임 25ms) */
const MAX_PIXEL_RATIO = 1.5;

const disposeMaterial = (material: Material) => {
  for (const value of Object.values(material)) {
    if (value && typeof value === "object" && (value as Texture).isTexture)
      (value as Texture).dispose();
  }
  material.dispose();
};

/**
 * 면접관 장면을 만든다. 모델을 다 불러오면 첫 장면을 그리고 돌려준다.
 * 자세는 내보낸 poseEndpoints.read에 맞춰 종이를 들고 읽는 자세로 둔다(Figma S06 · S06-B 면접관 장면).
 * onLost는 그리는 도중 WebGL 컨텍스트를 잃었을 때 부른다.
 */
export async function createInterviewerScene({
  canvas,
  model,
  frame,
  storm: stormVideo,
  interior,
  background,
  lights = DEFAULT_LIGHTS,
  onLost,
  signal,
  headBone,
}: {
  canvas: HTMLCanvasElement;
  model: InterviewerModel;
  frame: CameraFrame;
  /** 폭풍 배경(먹구름 번개 영상 · 3D 번개 · 지옥불)을 쓸 때 그 영상 주소. 없으면 background 그림을 깔고, 그것도 없으면 투명하게 그린다. */
  storm?: string;
  /** 폭풍 배경 앞에 까는 실내 그림(창문은 투명) */
  interior?: string;
  /** 면접관 뒤에 까는 배경 그림(화면을 채움). 폭풍 배경과 같이 쓰지 않는다. */
  background?: string;
  /** 조명. 없으면 기본 조명 */
  lights?: SceneLights;
  onLost: () => void;
  signal: AbortSignal;
  headBone?: string;
}): Promise<InterviewerScene> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = lights.exposure;
  const shadow = stormVideo ? undefined : lights.shadow;
  if (shadow) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
  }

  const scene = new Scene();
  const camera = new PerspectiveCamera(frame.fov, 1, 0.005, 20);
  camera.position.set(...frame.position);
  camera.lookAt(...frame.target);
  const hemi = new HemisphereLight(lights.hemi.sky, lights.hemi.ground, lights.hemi.intensity);
  scene.add(hemi);
  const key = new DirectionalLight(lights.key.color, lights.key.intensity);
  key.position.set(...lights.key.position);
  scene.add(key);
  const fill = new DirectionalLight(lights.fill.color, lights.fill.intensity);
  fill.position.set(...lights.fill.position);
  scene.add(fill);

  let mixer: AnimationMixer | null = null;
  let storm: Storm | null = null;
  let backdrop: Backdrop | null = null;
  /** 이 장면이 꺼내 쓴 모델. 정리할 때 GPU 자원만 놓고 캐시에 되돌려 둔다 */
  let assets: InterviewerAssets | null = null;
  const release = () => {
    renderer.setAnimationLoop(null);
    storm?.dispose();
    backdrop?.dispose();
    mixer?.stopAllAction();
    scene.traverse((object: Object3D) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(disposeMaterial);
    });
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.removeEventListener("webglcontextlost", lost);
    // 해석한 모델(형상 · 텍스처 원본)은 남아 있어 다음 장면이 GPU에 다시 올려 쓸 수 있다. Next는 떠난 화면을 숨겨 두었다가(Activity)
    // 돌아오면 효과를 다시 실행하므로, 되돌려 두면 다시 받거나 해석하지 않는다(drei useGLTF.preload와 같은 모듈 캐시 방식).
    if (assets) returnAssets(model, assets);
  };
  const lost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lost);

  try {
    assets = await takeAssets(model);
    // 다 받기 전에 화면을 떠났으면(개발 모드에서는 효과가 두 번 실행되며 첫 번째가 바로 정리된다) release가 모델을 되돌려 둔다.
    signal.throwIfAborted();
    const { gltf, rules, pose } = assets;
    scene.add(gltf.scene);

    // 자세: 내보낸 동작을 한 클립으로 묶고, 읽는 자세 시점에 멈춰 둔다.
    const tracks = gltf.animations.flatMap((clip) => clip.tracks);
    if (tracks.length === 0) throw new Error("모델에 동작이 없다");
    const start = Math.min(...tracks.map((track) => track.times[0]));
    const end = Math.max(...tracks.map((track) => track.times[track.times.length - 1]));
    mixer = new AnimationMixer(gltf.scene);
    const action: AnimationAction = mixer.clipAction(new AnimationClip("Pose", end, tracks));
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true;
    const [readRoute, readProgress] = pose.poseEndpoints.read;
    const readSegment = pose.segments[readRoute];
    action.time = start + MathUtils.lerp(readSegment.start, readSegment.end, readProgress);
    mixer.update(0);
    const moveHead = createHeadControl(gltf.scene, headBone);

    // 주광 그림자: 면접관 · 책상 · 컵이 서로와 바닥에 그림자를 드리운다. 바닥은 모델 맨 아래(의자 · 신발 바닥) 높이다.
    if (shadow) {
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0005;
      key.shadow.normalBias = 0.02;
      const box = key.shadow.camera;
      box.left = -1.5;
      box.right = 1.5;
      box.top = 1.5;
      box.bottom = -1.5;
      box.near = 0.1;
      box.far = 8;
      box.updateProjectionMatrix();
      // 그림자는 소품(책상 · 컵 · 종이 · 바닥)만 받는다. 면접관 몸(스킨 메시)까지 받으면 안경 · 머리카락 그림자가 얼굴에 줄처럼 진다.
      gltf.scene.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = !(mesh as SkinnedMeshLike).isSkinnedMesh;
      });
      gltf.scene.updateMatrixWorld(true);
      const floor = new Mesh(
        new PlaneGeometry(8, 8),
        new ShadowMaterial({ color: shadow.color, opacity: shadow.opacity }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = new Box3().setFromObject(gltf.scene).min.y;
      floor.receiveShadow = true;
      scene.add(floor);
    }

    // 표정: 규칙에 있는 메시(WEB_<이름> 아래)를 찾아 셰이프 키 세기를 넣는다.
    const normal = (name: string) => name.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const faceMeshes: Record<string, Mesh[]> = {};
    for (const name of Object.keys(rules.rules)) {
      const wanted = normal(`WEB_${name}`);
      const found: Mesh[] = [];
      gltf.scene.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
        for (
          let parent: Object3D | null = mesh;
          parent && parent !== gltf.scene;
          parent = parent.parent
        ) {
          const n = normal(parent.name);
          if (n === wanted || n.startsWith(`${wanted}_`)) {
            found.push(mesh);
            break;
          }
        }
      });
      if (found.length) faceMeshes[name] = found;
    }
    const surfaces = Object.values(faceMeshes).map(createFaceSurface);

    // 얼굴 조명: 표정 메시(얼굴 · 눈썹 등)를 감싼 상자의 가운데를 겨누고, 그 상자만큼만 퍼지게 원뿔 각을 잡는다(가장자리는 부드럽게).
    const faceLight = stormVideo ? undefined : lights.face;
    const faceParts = Object.values(faceMeshes).flat();
    if (faceLight && faceParts.length > 0) {
      const bounds = new Box3();
      faceParts.forEach((mesh) => bounds.expandByObject(mesh));
      const center = bounds.getCenter(new Vector3());
      const radius = bounds.getSize(new Vector3()).length() / 2;
      const spot = new SpotLight(faceLight.color, faceLight.intensity);
      spot.position.set(...faceLight.position);
      spot.target.position.copy(center);
      spot.angle = Math.atan(radius / spot.position.distanceTo(center));
      spot.penumbra = 1;
      spot.decay = 0;
      scene.add(spot, spot.target);
    }

    let face: FaceControls = NEUTRAL_FACE;
    let dirty = true;
    const applyFace = () => {
      const weight = faceWeights(rules, face);
      for (const [name, meshes] of Object.entries(faceMeshes)) {
        for (const mesh of meshes) {
          for (const [shape, index] of Object.entries(mesh.morphTargetDictionary ?? {})) {
            mesh.morphTargetInfluences![index] = weight(name, shape);
          }
        }
      }
      surfaces.forEach((update) => update());
    };

    if (stormVideo) {
      storm = setupStorm({
        renderer,
        scene,
        camera,
        lights: { hemi, key, fill },
        video: stormVideo,
        interior,
      });
    } else if (background) {
      backdrop = setupBackdrop({ scene, url: background, onLoad: () => (dirty = true) });
    }

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = canvas;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // 세로로 긴 화면에서도 면접관이 잘리지 않게, 화면이 좁아질수록 화각을 넓힌다.
      camera.fov =
        width >= height
          ? frame.fov
          : MathUtils.radToDeg(
              2 * Math.atan(Math.tan(MathUtils.degToRad(frame.fov) / 2) * (height / width)),
            );
      camera.updateProjectionMatrix();
      storm?.resize(width, height);
      backdrop?.resize(width, height);
      dirty = true;
    };
    resize();

    // 폭풍 배경은 매 프레임 움직여 계속 그린다. 폭풍 배경이 아니면(멈춘 그림 배경 포함) 표정이나 크기가 바뀐 프레임에만 다시 그린다.
    let last = performance.now();
    // 그림자 지도는 첫 프레임에 비어 그려질 수 있어, 처음에는 한 프레임 더 그린다.
    let warmup = shadow ? 1 : 0;
    renderer.setAnimationLoop((now: number) => {
      if (storm) {
        storm.update(Math.min((now - last) / 1000, 0.25), now);
        last = now;
      }
      if (dirty) applyFace();
      if (storm) storm.render();
      else if (dirty) renderer.render(scene, camera);
      dirty = warmup-- > 0;
    });

    return {
      setHead(pitch, roll) {
        moveHead(pitch, roll);
        dirty = true;
      },
      setFace(next) {
        face = { ...face, ...next, mouth: { ...face.mouth, ...next.mouth } };
        dirty = true;
      },
      resize,
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
