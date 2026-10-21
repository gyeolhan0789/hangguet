import { getHttpStatus, getProblemDetail } from "@/lib/api/problem-detail";

// 기준: Swagger 5.10 실시간 음성 인식 토큰 · 5.12 질문 음성 토큰 · API 명세 1장(실패 응답: 화면 분기는 code,
// Nginx가 직접 주는 502 · 504는 본문 형식을 보장하지 않아 상태 코드로 판단)
// "use server" 파일은 async 함수만 내보낼 수 있어, 서버 액션들이 함께 쓰는 실패 모양과 분류 함수를 여기 둔다.

/**
 * 음성 토큰 · 답변 서버 액션이 돌려주는 실패. 폼이 아닌 호출이라 FormActionResult 대신 이 모양을 쓴다.
 * code는 ProblemDetail의 code(본문이 없으면 null), status는 HTTP 상태(응답이 아예 없으면 null)다.
 */
export interface SpeechActionFailure {
  ok: false;
  code: string | null;
  status: number | null;
}

/**
 * API 오류를 SpeechActionFailure로 바꾼다. 인자 없이 부르면(잘못된 id처럼 API를 부르지 않은 실패) code · status 모두 null.
 * 401 재발급 · redirect 신호는 이 함수 전에 unstable_rethrow로 다시 던진다.
 */
export function toSpeechActionFailure(error?: unknown): SpeechActionFailure {
  return { ok: false, code: getProblemDetail(error)?.code ?? null, status: getHttpStatus(error) };
}
