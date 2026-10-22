import {
  AnimationClip,
  AnimationMixer,
  DirectionalLight,
  HemisphereLight,
  LoopOnce,
  MathUtils,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  WebGLRenderer,
  type AnimationAction,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import { faceWeights, NEUTRAL_FACE, type FaceControls, type FaceRules } from "./face-rules";
import { createFaceSurface } from "./face-surface";
import { setupStorm, type Storm } from "./storm";

// 면접관 3D 장면(three.js). 모델 · 표정 규칙 · 자세 구간을 불러와 캔버스에 그린다. 화면(React)과 따로 두어 브라우저에서만 불러온다.
// 기준: 면접관 3D 모델 웹 미리보기(office_animation/web app.js: 조명 · 톤 매핑 · 표정 · 자세 진행도 · 최종 검증 FINAL_PREVIEW_REPORT.json)
// · 면접관 표현 모듈 결정 ③-3(박연수/interviewer-avatar decisions.md: 렌더 크기 = 표시 크기 × 기기 배율, 실패 시 정지 이미지)
// · three.js 매뉴얼 How to dispose of objects · WebGLRenderer.setAnimationLoop(정리할 때 루프를 멈춘 뒤 dispose)

/** 모델 파일 묶음 */
export interface InterviewerModel {
  /** 몸 · 얼굴 · 책상 · 의자 · 종이가 든 GLB(meshopt 압축) */
  glb: string;
  /** 표정 규칙(face-rules.json) */
  faceRules: string;
  /** 자세 전환 구간(animation.json) */
  animation: string;
}

interface PoseSegments {
  seconds: number;
  segments: Record<"down" | "up", { start: number; end: number }>;
}

/** 카메라 위치 · 바라보는 점(모델 좌표, 미터) */
export interface CameraFrame {
  position: [number, number, number];
  target: [number, number, number];
  /** 세로 화각(도) */
  fov: number;
}

export interface InterviewerScene {
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

/** 모델 · 표정 규칙 · 자세 구간을 내려받아 해석한다(meshopt 압축 풀기 포함). */
function loadAssets(model: InterviewerModel): Promise<InterviewerAssets> {
  const fetchJson = <T>(url: string) =>
    fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url} ${response.status}`);
      return response.json() as Promise<T>;
    });
  return Promise.all([
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(model.glb),
    fetchJson<FaceRules>(model.faceRules),
    fetchJson<PoseSegments>(model.animation),
  ]).then(([gltf, rules, pose]) => ({ gltf, rules, pose }));
}

/**
 * 면접 화면에 오기 전(S05 장치 점검)에 모델을 미리 내려받아 해석해 둔다. 이미 불러오는 중이면 아무것도 하지 않는다.
 * 화면 사이 이동(클라이언트 이동)에서는 이 결과가 남아 있어, 면접 화면은 GPU에 올려 그리기만 하면 된다.
 */
export function preloadInterviewerAssets(model: InterviewerModel) {
  if (preloaded.has(model.glb)) return;
  const loading = loadAssets(model);
  // 실패하면 지워, 면접 화면이 처음부터 다시 불러오게 한다.
  loading.catch(() => preloaded.delete(model.glb));
  preloaded.set(model.glb, loading);
}

/** 미리 불러 둔 모델을 꺼낸다(한 장면에서만 쓴다). 없으면 지금 불러온다. */
function takeAssets(model: InterviewerModel): Promise<InterviewerAssets> {
  const loading = preloaded.get(model.glb);
  preloaded.delete(model.glb);
  return loading ?? loadAssets(model);
}

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
 * 자세는 종이를 들고 읽는 자세(구간 down의 시작)로 둔다(Figma S06 · S06-B 면접관 장면).
 * onLost는 그리는 도중 WebGL 컨텍스트를 잃었을 때 부른다.
 */
export async function createInterviewerScene({
  canvas,
  model,
  frame,
  storm: stormVideo,
  interior,
  onLost,
  signal,
}: {
  canvas: HTMLCanvasElement;
  model: InterviewerModel;
  frame: CameraFrame;
  /** 폭풍 배경(먹구름 번개 영상 · 3D 번개 · 지옥불)을 쓸 때 그 영상 주소. 없으면 배경 없이 투명하게 그린다. */
  storm?: string;
  /** 폭풍 배경 앞에 까는 실내 그림(창문은 투명) */
  interior?: string;
  onLost: () => void;
  signal: AbortSignal;
}): Promise<InterviewerScene> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new Scene();
  const camera = new PerspectiveCamera(frame.fov, 1, 0.005, 20);
  camera.position.set(...frame.position);
  camera.lookAt(...frame.target);
  const hemi = new HemisphereLight(0xdde9ff, 0x504033, 2.4);
  scene.add(hemi);
  const key = new DirectionalLight(0xffe4c6, 3);
  key.position.set(-1.2, 2, 2);
  scene.add(key);
  const fill = new DirectionalLight(0xb8d2ff, 1.3);
  fill.position.set(1.8, 1, -1);
  scene.add(fill);

  let mixer: AnimationMixer | null = null;
  let storm: Storm | null = null;
  const release = () => {
    renderer.setAnimationLoop(null);
    storm?.dispose();
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
  };
  const lost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lost);

  try {
    const { gltf, rules, pose } = await takeAssets(model);
    signal.throwIfAborted();
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
    action.time = start + pose.segments.down.start;
    mixer.update(0);

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
      dirty = true;
    };
    resize();

    // 폭풍 배경은 매 프레임 움직여 계속 그린다. 배경이 없으면 표정이나 크기가 바뀐 프레임에만 다시 그린다.
    let last = performance.now();
    renderer.setAnimationLoop((now: number) => {
      if (storm) {
        storm.update(Math.min((now - last) / 1000, 0.25), now);
        last = now;
      }
      if (dirty) applyFace();
      if (storm) storm.render();
      else if (dirty) renderer.render(scene, camera);
      dirty = false;
    });

    return {
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
