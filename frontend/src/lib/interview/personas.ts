import type { Persona } from "@/types/api";

// 기준: Swagger 5.1 SessionCreateRequest.persona(DEVIL · COFFEE_CHAT) · Figma S04 Persona List(18:2171)

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
