import {
  DirectionalLight,
  HalfFloatType,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  NeutralToneMapping,
  PMREMGenerator,
  PointLight,
  SRGBColorSpace,
  Vector2,
  PlaneGeometry,
  TextureLoader,
  Vector3,
  VideoTexture,
  WebGLRenderTarget,
  type HemisphereLight,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { LightningStrike } from "./vendor/LightningStrike.js";

// 악마 면접관의 폭풍 배경. 면접 데모(interview_prototype public/js/env/storm.js · env/common.js upgradeRenderer)를 그대로 옮겼다.
// 먹구름 번개 영상 배경(그 앞에 창문만 뚫린 실내 그림) + 영상이 번쩍이면 얼굴에도 번개 빛 + 뒤쪽 3D 번개 줄기 + 아래쪽 지옥불 깜빡임 + 블룸.
// 영상: "Lightning cutting through the clouds"(#29354) — Mixkit(Mixkit Free License) https://mixkit.co/free-stock-video/thunderstorm/
// 번개 줄기: three.js LightningStrike(MIT, three r152 examples — ./vendor)
// 기준: 기획 메모 S06(18:757: 배경 씬은 페르소나별 — 악마 = 번개 폭풍)

export interface StormLights {
  hemi: HemisphereLight;
  key: DirectionalLight;
  fill: DirectionalLight;
}

export interface Storm {
  /** 매 프레임 번개 · 조명 깜빡임을 진행한다(dt 초, now 밀리초). */
  update: (dt: number, now: number) => void;
  /** 블룸을 거쳐 그린다. */
  render: () => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
}

/** 텍스처를 CSS background-size: cover처럼 화면에 맞춘다. */
function fitCover(texture: Texture, viewAspect: number) {
  const image = texture.image as HTMLVideoElement | undefined;
  const width = image?.videoWidth;
  const height = image?.videoHeight;
  if (!width || !height) return;
  const imageAspect = width / height;
  texture.matrixAutoUpdate = true;
  if (viewAspect > imageAspect) texture.repeat.set(1, imageAspect / viewAspect);
  else texture.repeat.set(viewAspect / imageAspect, 1);
  texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
}

export function setupStorm({
  renderer,
  scene,
  camera,
  lights: { hemi, key, fill },
  video: videoUrl,
  interior: interiorUrl,
}: {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  lights: StormLights;
  /** 먹구름 번개 영상 주소 */
  video: string;
  /** 면접관 뒤 실내 그림(창문은 투명). 창문 너머로 먹구름 영상 · 번개 줄기가 보인다. */
  interior?: string;
}): Storm {
  /* ---------- 렌더러: 톤 매핑 · MSAA 후처리 + 블룸(번개 · 빛나는 눈) ---------- */
  renderer.toneMapping = NeutralToneMapping; // 영상 배경 색을 원래 색에 가깝게 둔다
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new Vector2(1, 1), 0.7, 0.5, 0.78);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  /* ---------- 먹구름 영상 배경 ---------- */
  const video = document.createElement("video");
  Object.assign(video, {
    src: videoUrl,
    muted: true,
    loop: true,
    playsInline: true,
    autoplay: true,
    crossOrigin: "anonymous",
  });
  video.setAttribute("playsinline", "");
  const play = () => void video.play().catch(() => {});
  play();
  addEventListener("pointerdown", play, { once: true });
  const videoTexture = new VideoTexture(video);
  videoTexture.colorSpace = SRGBColorSpace;
  let viewAspect = 1;
  video.addEventListener(
    "loadedmetadata",
    () => {
      scene.background = videoTexture;
      fitCover(videoTexture, viewAspect);
    },
    { once: true },
  );

  // 영상 밝기를 매 프레임 읽어, 구름 속 번개가 치면 면접관 얼굴도 밝힌다.
  const probe = document.createElement("canvas");
  probe.width = 32;
  probe.height = 18;
  const probeContext = probe.getContext("2d", { willReadFrequently: true });
  let baseline = 60;
  let videoFlash = 0;
  function sampleVideo() {
    if (!probeContext || video.readyState < 2) return 0;
    probeContext.drawImage(video, 0, 0, 32, 18);
    const data = probeContext.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    }
    const luminance = sum / (data.length / 4);
    baseline = Math.min(luminance, baseline * 0.995 + luminance * 0.005); // 어두운 구름 밝기에 맞춰 간다
    // 이 영상의 번개는 가늘어서, 구름 바닥 밝기보다 조금만 올라가도 번개로 본다.
    return MathUtils.clamp((luminance - baseline - 6) / 8, 0, 1);
  }

  /* ---------- 어둡고 차가운 폭풍 조명 + 아래에서 올라오는 지옥불 ---------- */
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.12; // 뿔 · 눈의 윤기만 살릴 정도

  hemi.color.set(0x5b6390);
  hemi.groundColor.set(0x1a0406);
  hemi.intensity = 0.55;
  key.color.set(0xaab6ff);
  key.intensity = 1.0;
  key.position.set(-3.6, 5.5, 4.2); // 차가운 폭풍 빛
  fill.color.set(0x6f78c8);
  fill.intensity = 0.35;
  const redRim = new DirectionalLight(0xff3a2c, 9); // 지옥의 테두리 빛
  redRim.position.set(2.8, 1.6, -2.2);
  const under = new PointLight(0xff4a1c, 3.2, 9); // 아래에서 올라오는 지옥불
  under.position.set(0, -3.1, 2.2);
  scene.add(redRim, under);

  // 번개 빛: 번개가 칠 때마다 왼쪽 뒤에서 들어오는 차갑고 강한 빛
  const flash = new DirectionalLight(0xdfe6ff, 0);
  flash.position.set(-2.5, 6, -1.5);
  scene.add(flash);
  const flashFront = new PointLight(0xc9d4ff, 0, 30, 1.2);
  flashFront.position.set(-3, 4, 6);
  scene.add(flashFront);

  /* ---------- 하늘과 면접관 사이의 실내 그림(창문은 투명) ---------- */
  // 카메라에 붙인 판이라 화면을 늘 덮고(cover), 깊이는 면접관(약 1.7m)과 번개 줄기(약 9~14m) 사이(INTERIOR_DISTANCE)에 둔다.
  // 그래서 번개 줄기는 창문으로만 보이고, 면접관 · 책상은 그 앞에 그려진다.
  const INTERIOR_DISTANCE = 4.5;
  const interiorMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  const interior = new Mesh(new PlaneGeometry(1, 1), interiorMaterial);
  interior.position.set(0, 0, -INTERIOR_DISTANCE);
  interior.visible = false;
  let interiorAspect = 1;
  let disposed = false;
  if (interiorUrl) {
    scene.add(camera);
    camera.add(interior);
    new TextureLoader().load(interiorUrl, (texture) => {
      // 그림을 받기 전에 장면을 정리했으면 받은 텍스처도 바로 놓는다.
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = SRGBColorSpace;
      interiorMaterial.map = texture;
      interiorMaterial.needsUpdate = true;
      const image = texture.image as { width: number; height: number };
      interiorAspect = image.width / image.height;
      fitInterior();
      interior.visible = true;
    });
  }
  /** 실내 그림을 화면에 꽉 차게(cover) 맞춘다. */
  function fitInterior() {
    const viewHeight = 2 * INTERIOR_DISTANCE * Math.tan(MathUtils.degToRad(camera.fov) / 2);
    const viewWidth = viewHeight * camera.aspect;
    if (camera.aspect > interiorAspect)
      interior.scale.set(viewWidth, viewWidth / interiorAspect, 1);
    else interior.scale.set(viewHeight * interiorAspect, viewHeight, 1);
  }

  /* ---------- 면접관 뒤쪽 3D 번개 줄기 ---------- */
  const boltMaterial = new MeshBasicMaterial({
    color: 0xe6ecff,
    transparent: true,
    depthWrite: false,
  });
  const bolts: { mesh: Mesh<LightningStrike, MeshBasicMaterial>; t0: number; life: number }[] = [];
  function strike(t: number) {
    const x = (Math.random() < 0.5 ? -1 : 1) * MathUtils.randFloat(1.6, 4.8);
    const z = MathUtils.randFloat(-12, -7);
    const life = MathUtils.randFloat(0.5, 0.9);
    const geometry = new LightningStrike({
      sourceOffset: new Vector3(x + MathUtils.randFloatSpread(1.5), 7.5, z),
      destOffset: new Vector3(x + MathUtils.randFloatSpread(4), -5, z),
      radius0: 0.07,
      radius1: 0.025,
      minRadius: 0.006,
      maxIterations: 7,
      isEternal: false,
      birthTime: t,
      deathTime: t + life,
      timeScale: 0.6,
      propagationTimeFactor: 0.12,
      vanishingTimeFactor: 0.7,
      subrayPeriod: 0.35,
      subrayDutyCycle: 0.6,
      maxSubrayRecursion: 3,
      ramification: 7,
      recursionProbability: 0.55,
      roughness: 0.86,
      straightness: 0.62,
    });
    const mesh = new Mesh(geometry, boltMaterial.clone());
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    scene.add(mesh);
    bolts.push({ mesh, t0: t, life });
  }

  let nextBoltAt = 2.5;
  let wasBright = false;
  let boltFlash = 0;
  function update(dt: number, now: number) {
    const t = now / 1000;
    videoFlash = Math.max(sampleVideo(), videoFlash - dt * 3.5);

    // 구름이 밝아질 때(영상과 맞춰), 또는 몇 초마다 스스로 번개를 친다.
    const bright = videoFlash > 0.45;
    if ((bright && !wasBright && t > nextBoltAt - 3) || t > nextBoltAt) {
      strike(t);
      if (Math.random() < 0.35) strike(t + 0.08);
      nextBoltAt = t + MathUtils.randFloat(4, 9);
    }
    wasBright = bright;

    boltFlash = Math.max(0, boltFlash - dt * 5);
    for (let i = bolts.length - 1; i >= 0; i--) {
      const bolt = bolts[i];
      const age = t - bolt.t0;
      if (age > bolt.life) {
        scene.remove(bolt.mesh);
        bolt.mesh.geometry.dispose();
        bolt.mesh.material.dispose();
        bolts.splice(i, 1);
        continue;
      }
      bolt.mesh.geometry.update(t);
      const flicker = 0.55 + 0.45 * Math.sin(age * 90) * Math.sin(age * 37);
      const envelope = 1 - age / bolt.life;
      bolt.mesh.material.opacity = envelope * (0.6 + 0.4 * flicker);
      boltFlash = Math.max(boltFlash, envelope * flicker);
    }

    const strength = Math.max(videoFlash * 0.85, boltFlash);
    flash.intensity = strength * 7;
    flashFront.intensity = strength * 40;
    hemi.intensity = 0.55 + strength * 0.9;

    // 아래쪽 지옥불 깜빡임
    under.intensity = 3.0 + Math.sin(t * 7.3) * 0.35 + Math.sin(t * 17.1) * 0.25;
  }

  function resize(width: number, height: number) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
    bloomPass.resolution.set(width / 2, height / 2);
    viewAspect = width / height;
    fitCover(videoTexture, viewAspect);
    fitInterior();
  }

  function dispose() {
    disposed = true;
    removeEventListener("pointerdown", play);
    video.pause();
    video.removeAttribute("src");
    video.load();
    videoTexture.dispose();
    interiorMaterial.map?.dispose();
    interiorMaterial.dispose();
    interior.geometry.dispose();
    for (const bolt of bolts) {
      bolt.mesh.geometry.dispose();
      bolt.mesh.material.dispose();
    }
    boltMaterial.dispose();
    environment.dispose();
    pmrem.dispose();
    bloomPass.dispose();
    composer.dispose();
    target.dispose();
  }

  return { update, render: () => composer.render(), resize, dispose };
}
