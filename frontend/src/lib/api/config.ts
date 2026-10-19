// 기본 주소는 배포된 목 서버. 로컬 목 서버나 실제 백엔드는 NEXT_PUBLIC_API_BASE_URL로 바꾼다.
const API_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://hangguet.yobistory.com/mock/be";

export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

export const defaultConfig = {
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
};
