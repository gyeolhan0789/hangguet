import type { Persona } from "@/types/api";

import type { CameraFrame, InterviewerModel, SceneLights } from "./scene";

// 면접관(persona)별 3D 모델. 기준: Swagger 5.1 Persona(DEVIL · COFFEE_CHAT)
// · 승인된 면접관 3D 모델(three_pose_final/web/assets: demon-native-lips.glb · face-rules-native-lips.json · three-poses.json, 2026-10-22)
// · Figma S06 Interviewer Scene(18:2498: 면접관 얼굴이 화면 가운데 위, 종이를 든 손 · 책상이 아래)
// · 사용자 결정(2026-10-26: 커피챗도 같은 코드 · 같은 자산 형식으로 그린다. 카메라는 S06과 같은 구도(얼굴 가운데 화면 위 약 32%),
//   배경은 카페 실내 그림 1장(낮 창가 햇빛), 조명은 커피챗만 배경에 맞춘다) · 커피챗 모델(coffeechat-avatar v4, 소품 출처는
//   public/interview/coffee-chat/CREDITS.txt)
// · 오리 모델(public/interview/duck/README.md · manifest.json: 동작 클립 idle · nod · talk, 표정 규칙 face-rules.json)
// · 사용자 결정(2026-11-04: 오리는 Figma에 없어 기존 면접관과 같은 방식으로 — 카메라는 얼굴이 화면 위쪽 · 발이 대사창 위에 오게,
//   배경은 Codex로 만든 호수 물가 그림 1장, 조명은 배경에 맞춘다)

export interface InterviewerLook {
  /** 고개 제어에 쓰는 머리 뼈대. 동작 클립이 머리를 움직이는 면접관은 비워 둔다 */
  headBone?: string;
  model: InterviewerModel;
  /** Figma 장면과 같은 구도의 카메라 */
  frame: CameraFrame;
  /** 3D를 그릴 수 없을 때 보여 줄 정지 이미지(면접관 표현 결정 ③-3) */
  still: string;
  /** 폭풍 배경 영상(먹구름 번개). 배경이 없는 면접관은 비워 둔다. */
  storm?: string;
  /** 폭풍 배경 앞에 까는 실내 그림(창문은 투명) */
  interior?: string;
  /** 면접관 뒤에 까는 배경 그림(화면을 채움). 폭풍 배경이 없는 면접관만 쓴다. */
  background?: string;
  /** 배경에 맞춘 조명. 없으면 기본 조명 */
  lights?: SceneLights;
}

/** 면접관별 배경 효과(기획 메모 S06: 배경 씬은 페르소나별 — 악마 = 번개 폭풍, 커피챗 = 카페, 오리 = 호수 물가) */
export type InterviewerBackdrop = "storm" | "cafe" | "lake" | null;

/** 호수 물가 배경(왼쪽 위 햇살, 맑은 낮)에 맞춘 오리 조명. 발밑 풀밭에 그림자가 진다 */
const DUCK_LIGHTS: SceneLights = {
  exposure: 1.1,
  hemi: { sky: 0xdcecff, ground: 0x7d8f5a, intensity: 1.5 },
  key: { color: 0xfff0d6, intensity: 2.8, position: [-1.6, 2.4, 1.4] },
  fill: { color: 0xd6e8ff, intensity: 0.8, position: [1.6, 1, 2] },
  shadow: { color: 0x2f4a22, opacity: 0.35 },
};

// Record<Persona, …>라서 Persona가 늘거나 줄면 여기서 컴파일 오류가 난다.
const LOOKS = {
  DEVIL: {
    headBone: "DEF-spine.006",
    model: {
      glb: "/interview/devil/interviewer.glb",
      glbBytes: 31_580_308,
      faceRules: "/interview/devil/face-rules.json",
      animation: "/interview/devil/animation.json",
    },
    frame: { position: [0, 0.91, 1.74], target: [0, 0.65, 0.1], fov: 34 },
    still: "/interview/devil/still.webp",
    // 면접 데모(interview_prototype)의 악마 폭풍 배경 영상(Mixkit #29354, Mixkit Free License)
    storm: "/interview/devil/storm.mp4",
    // 사무실 실내. Figma 이미지 생성(gemini-3.1-flash-image)으로 만들고 창문(크로마키 초록)만 투명하게 뺐다.
    interior: "/interview/devil/office.webp",
  },
  COFFEE_CHAT: {
    headBone: "Head",
    model: {
      glb: "/interview/coffee-chat/interviewer.glb",
      glbBytes: 413_868,
      faceRules: "/interview/coffee-chat/face-rules.json",
      animation: "/interview/coffee-chat/animation.json",
    },
    // 읽는 자세에서 얼굴 메시 가운데가 화면 위 32%, 종이 든 손이 52~65%(three.js로 투영해 잼).
    // 아래 대사창(1024×768에서 화면 62%부터)에 손이 가려지지 않게 둔 거리(사용자 요청 2026-10-26)
    frame: { position: [0, 0.921, 1.892], target: [0, 0.613, 0.1], fov: 34 },
    still: "/interview/coffee-chat/still.webp",
    // 카페 실내(낮, 왼쪽 큰 창). Codex 이미지 생성(gpt-5.6-sol)으로 만들어 webp로 줄였다.
    // 사용자 요청(2026-10-26: 캐릭터와 배경의 투시가 맞지 않음) — 이 카메라(frame)로 바닥 · 뒷벽 격자를 그린 그림을 주고
    // 같은 투시(소실점 가운데 화면 위 22%, 뒷벽 밑선 화면 위 48%, 바닥이 아래 절반)로 다시 그렸다.
    background: "/interview/coffee-chat/cafe.webp",
    // 배경의 햇빛(왼쪽 창에서 조금 뒤쪽 · 낮고 따뜻함)에 맞춘 주광. 바닥 그림자가 오른쪽 앞으로 길게 떨어진다.
    // 주광이 옆에서 오므로 고개 숙인 얼굴에 위쪽 그늘(코 밑)이 지지 않고, 앞의 보조광 · 나무 바닥 반사광이 그늘진 쪽을 채운다.
    lights: {
      exposure: 1.08,
      // 아래쪽 반사광은 밝은 나무 바닥 · 피부빛에 가깝게 둬 코 밑 같은 아래를 향한 면이 갈색으로 짙어지지 않게 한다
      hemi: { sky: 0xffecd2, ground: 0xe0bc98, intensity: 1.1 },
      key: { color: 0xffc887, intensity: 5.0, position: [-2.4, 1.5, -0.2] },
      fill: { color: 0xffe6c8, intensity: 1.1, position: [0.8, 0.6, 2.4] },
      shadow: { color: 0x4a2810, opacity: 0.45 },
      // 얼굴만 따로 밝힌다(사용자 요청 2026-10-26: 얼굴에만 빛, 안경 그림자 이상함, 코 밑 그늘). 고개를 숙인 얼굴을
      // 얼굴보다 아래 · 정면에서 비춰 코 밑까지 밝힌다(위에서 비추면 코 밑이 짙게 그늘진다).
      face: { color: 0xffe2c4, intensity: 3, position: [-0.2, 0.45, 1.8] },
    },
  },
  DUCK: {
    // 머리는 동작 클립(끄덕임 · 말하기)이 움직이므로 고개 제어를 쓰지 않는다
    model: {
      glb: "/interview/duck/interviewer.glb",
      glbBytes: 7_168_564,
      faceRules: "/interview/duck/face-rules.json",
      clips: {
        idle: "Duck_Folded_Idle",
        nod: "Duck_Nod_Double",
        talk: "Duck_Talk",
        surprise: "Duck_Surprise",
        // 위에서 내려다보는 카메라를 올려다보게 고개를 든다(28도: 얼굴이 카메라를 향하고 목 이음새가 드러나지 않는 각도)
        headLift: { node: "Duck_Head", degrees: 28 },
        // 놀랄 때 날개 · 고개를 절반만 움직인다(사용자 요청 2026-11-04: 날개를 덜 펴고 고개를 덜 돌리고 덜 올리기)
        surpriseScale: { Duck_Wing: 0.25, Duck_Head: 0.25 },
      },
    },
    // 키 0.56m 오리를 1.35m 앞 · 1.3m 높이에서 내려다본다(사용자 요청 2026-11-04: 위에서 내려다보는 구도, 높이 1.3m).
    // 1440×900에서 머리 꼭대기가 화면 위 11%, 발이 63%(대사창 바로 위)
    frame: { position: [0, 1.3, 1.35], target: [0, 0.103, 0], fov: 34 },
    still: "/interview/duck/still.webp",
    background: "/interview/duck/lake.webp",
    lights: DUCK_LIGHTS,
  },
} satisfies Record<Persona, InterviewerLook | null>;

const BACKDROPS = {
  DEVIL: "storm",
  COFFEE_CHAT: "cafe",
  DUCK: "lake",
} satisfies Record<Persona, InterviewerBackdrop>;

/** 면접관의 배경 효과. 아직 없으면 null */
export function interviewerBackdrop(persona: Persona): InterviewerBackdrop {
  return BACKDROPS[persona];
}

/** 면접관의 3D 모델. 아직 없으면 null */
export function interviewerLook(persona: Persona): InterviewerLook | null {
  return LOOKS[persona];
}
