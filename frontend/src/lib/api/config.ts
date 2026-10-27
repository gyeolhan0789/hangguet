// API는 서버에서만 부르므로(client.ts) 서버 전용 환경 변수로 읽는다. NEXT_PUBLIC_이 아니어서 빌드할 때 값이 박히지 않고
// 서버가 실행될 때 읽는다. 그래서 같은 이미지를 환경마다 다른 주소로 띄울 수 있다(deploy/dev/compose.yml).
// 값은 /api/v1까지 포함한 주소다. 기본 주소는 배포된 목 서버. 로컬 목 서버나 실제 백엔드는 API_BASE_URL로 바꾼다.
// 예: API_BASE_URL=http://localhost:8080/api/v1
export const API_BASE_URL =
  process.env.API_BASE_URL ?? "https://hangguet.yobistory.com/mock/be/api/v1";

export const defaultConfig = {
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
};
