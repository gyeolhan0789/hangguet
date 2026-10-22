/**
 * 단위 테스트용: 목으로 바꾼 redirect가 던지는 "REDIRECT <주소>" 오류를 주소까지 정확히 맞춘다.
 * toThrow("REDIRECT /practice")처럼 문자열을 주면 부분 일치라 "/practice/mode"로 가도 통과하므로 앞뒤를 고정한다.
 */
export function redirectTo(url: string): RegExp {
  return new RegExp(`^REDIRECT ${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}
