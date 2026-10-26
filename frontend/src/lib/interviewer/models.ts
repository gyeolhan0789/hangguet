import type { Persona } from "@/types/api";

import type { CameraFrame, InterviewerModel, SceneLights } from "./scene";

// 면접관(persona)별 3D 모델. 기준: Swagger 5.1 Persona(DEVIL · COFFEE_CHAT)
// · 승인된 면접관 3D 모델(three_pose_final/web/assets: demon-native-lips.glb · face-rules-native-lips.json · three-poses.json, 2026-10-22)
// · Figma S06 Interviewer Scene(18:2498: 면접관 얼굴이 화면 가운데 위, 종이를 든 손 · 책상이 아래)
// · 사용자 결정(2026-10-26: 커피챗도 같은 코드 · 같은 자산 형식으로 그린다. 카메라는 S06과 같은 구도(얼굴 가운데 화면 위 약 32%),
//   배경은 카페 실내 그림 1장(낮 창가 햇빛), 조명은 커피챗만 배경에 맞춘다) · 커피챗 모델(coffeechat-avatar v4, 소품 출처는
//   public/interview/coffee-chat/CREDITS.txt)

export interface InterviewerLook {
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

/** 면접관별 배경 효과(기획 메모 S06: 배경 씬은 페르소나별 — 악마 = 번개 폭풍, 커피챗 = 카페 등) */
export type InterviewerBackdrop = "storm" | "cafe" | null;

// Record<Persona, …>라서 Persona가 늘거나 줄면 여기서 컴파일 오류가 난다.
const LOOKS = {
  DEVIL: {
    model: {
      glb: "/interview/devil/interviewer.glb",
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
    model: {
      glb: "/interview/coffee-chat/interviewer.glb",
      faceRules: "/interview/coffee-chat/face-rules.json",
      animation: "/interview/coffee-chat/animation.json",
    },
    // 읽는 자세에서 얼굴 메시 가운데가 화면 위 32%, 종이 든 손이 52~65%(three.js로 투영해 잼).
    // 아래 대사창(1024×768에서 화면 62%부터)에 손이 가려지지 않게 둔 거리(사용자 요청 2026-10-26)
    frame: { position: [0, 0.921, 1.892], target: [0, 0.613, 0.1], fov: 34 },
    still: "/interview/coffee-chat/still.webp",
    // 카페 실내(낮, 왼쪽 큰 창). Codex 이미지 생성(gpt-5.6-sol)으로 만들어 webp로 줄였다.
    background: "/interview/coffee-chat/cafe.webp",
    // 배경의 왼쪽 창 햇빛에 맞춘 따뜻한 주광 · 나무 바닥 반사광. 읽는 자세는 고개를 숙여 위에서 비추면 코 밑이 짙게 그늘지므로
    // 주광을 낮고 앞쪽에 두고 보조광을 아래 앞에서 비춘다(사용자 요청 2026-10-26: 코 아래 그림자가 짙음)
    lights: {
      exposure: 1.15,
      hemi: { sky: 0xfff2df, ground: 0x9a7656, intensity: 2.3 },
      key: { color: 0xffd9a8, intensity: 3.0, position: [-1.6, 1.2, 2.2] },
      fill: { color: 0xf3e6d4, intensity: 1.3, position: [1.2, 0.4, 2.2] },
    },
  },
} satisfies Record<Persona, InterviewerLook | null>;

const BACKDROPS = {
  DEVIL: "storm",
  COFFEE_CHAT: "cafe",
} satisfies Record<Persona, InterviewerBackdrop>;

/** 면접관의 배경 효과. 아직 없으면 null */
export function interviewerBackdrop(persona: Persona): InterviewerBackdrop {
  return BACKDROPS[persona];
}

/** 면접관의 3D 모델. 아직 없으면 null */
export function interviewerLook(persona: Persona): InterviewerLook | null {
  return LOOKS[persona];
}
