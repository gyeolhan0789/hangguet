import type { Persona } from "@/types/api";

// 기준: Swagger 5.1 SessionCreateRequest.persona(DEVIL · COFFEE_CHAT · DUCK) · Figma S04 Persona List(18:2171)
// · 오리 면접관은 Figma에 없어 사용자 결정(2026-11-04: 이름 · 태그 · 설명은 기본안, 순서는 악마 → 커피챗 → 오리)을 따른다.
//   설명은 AI 명세 2장(오리 면접관 = 자신감 연습 면접, 경험을 편하게 설명하는 말투)에 맞췄다.

export interface PersonaInfo {
  persona: Persona;
  name: string;
  /** 난이도 태그 */
  difficulty: string;
  description: string;
  /** Figma 3D 캐릭터 썸네일(메모 S04) */
  avatar: string;
}

// Record<Persona, …>라서 Persona에 값이 늘거나 줄면 여기서 컴파일 오류가 난다. 적은 순서가 화면 순서(Figma)다.
const PERSONA_INFO = {
  DEVIL: {
    name: "악마 면접관",
    difficulty: "난이도 높음",
    description: "압박 질문과 날카로운 꼬리 질문",
    avatar: "/practice/avatar-devil.webp",
  },
  COFFEE_CHAT: {
    name: "개발자 커피챗",
    difficulty: "난이도 낮음",
    description: "편안한 대화로 실무 이야기",
    avatar: "/practice/avatar-coffeechat.webp",
  },
  DUCK: {
    name: "오리 면접관",
    difficulty: "난이도 낮음",
    description: "칭찬 위주로 자신감 키우는 연습",
    // 오리 3D 모델(public/interview/duck/interviewer.glb)을 S04 썸네일 구도로 렌더한 그림
    avatar: "/practice/avatar-duck.webp",
  },
} satisfies Record<Persona, Omit<PersonaInfo, "persona">>;

/** 5.1이 받는 면접관 값(Figma 순서). 검증 스키마도 이 목록을 쓴다. */
export const PERSONA_VALUES = Object.keys(PERSONA_INFO) as Persona[];

/** S04에서 고를 수 있는 면접관(Figma 순서) */
export const PERSONAS: readonly PersonaInfo[] = PERSONA_VALUES.map((persona) => ({
  persona,
  ...PERSONA_INFO[persona],
}));

/** 주소의 persona 값을 읽는다. 5.1이 받는 값이 아니면 null */
export function parsePersona(value: string | string[] | undefined): Persona | null {
  return typeof value === "string" && Object.hasOwn(PERSONA_INFO, value)
    ? (value as Persona)
    : null;
}
