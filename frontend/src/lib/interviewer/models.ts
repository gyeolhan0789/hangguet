import type { Persona } from "@/types/api";

import type { CameraFrame, InterviewerModel } from "./scene";

// 면접관(persona)별 3D 모델. 기준: Swagger 5.1 Persona(DEVIL · COFFEE_CHAT)
// · 면접관 3D 모델(office_animation web/assets: demon-office-face-restored.glb · face-rules.json · animation-2s.json, 2026-10-21)
// · Figma S06 Interviewer Scene(18:2498: 면접관 얼굴이 화면 가운데 위, 종이를 든 손 · 책상이 아래)

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
}

/** 면접관별 배경 효과(기획 메모 S06: 배경 씬은 페르소나별 — 악마 = 번개 폭풍, 커피챗 = 카페 등). 커피챗 카페 배경은 아직 없다. */
export type InterviewerBackdrop = "storm" | null;

// Record<Persona, …>라서 Persona가 늘거나 줄면 여기서 컴파일 오류가 난다.
// 커피챗 면접관은 아직 3D 모델 · 카페 배경이 없다(null).
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
    // 랜딩 그림 같은 사무실 실내. Figma 이미지 생성(gemini-3.1-flash-image)으로 만들고 창문(크로마키 초록)만 투명하게 뺐다.
    interior: "/interview/devil/office.webp",
  },
  COFFEE_CHAT: null,
} satisfies Record<Persona, InterviewerLook | null>;

const BACKDROPS = {
  DEVIL: "storm",
  COFFEE_CHAT: null,
} satisfies Record<Persona, InterviewerBackdrop>;

/** 면접관의 배경 효과. 아직 없으면 null */
export function interviewerBackdrop(persona: Persona): InterviewerBackdrop {
  return BACKDROPS[persona];
}

/** 면접관의 3D 모델. 아직 없으면 null */
export function interviewerLook(persona: Persona): InterviewerLook | null {
  return LOOKS[persona];
}
