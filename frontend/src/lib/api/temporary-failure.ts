import { isAxiosError } from "axios";

// 화면이 2초마다 다시 그리며 부르는 조회(대기실 10.4 · 그룹 면접방 10.4 · 5.2)에서 BE가 잠깐 답하지 못한 것(연결 실패 · 5xx,
// 예: 배포 중 Cloudflare 502)을 가려낸다. 이때는 오류 화면으로 바꾸지 않고 직전 화면을 그대로 둔 채 다음 조회를 기다린다.

/** BE가 잠깐 답하지 못했다(응답 없음 · 5xx). 4xx는 요청에 대한 답이라 아니다 */
export function isTemporaryFailure(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status >= 500;
}

/** 조회가 잠깐 실패하면 던지지 않고 undefined(받지 못함)를 돌려준다. 그 밖의 실패는 그대로 던진다 */
export async function unlessTemporary<T>(request: Promise<T>): Promise<T | undefined> {
  try {
    return await request;
  } catch (error) {
    if (isTemporaryFailure(error)) return undefined;
    throw error;
  }
}
