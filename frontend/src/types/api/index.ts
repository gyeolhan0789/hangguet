// API 요청 · 응답 타입 모음. 기준: mock 서버(mock/src/main/java/com/ssafy/a301)와 Swagger.
// 폴더는 API 명세 장(1 인증 ~ 7 성장 리뷰)마다 나누고, 그 안에서 request · response로 나눈다.
export type * from "./common";
export type * from "./auth/request";
export type * from "./auth/response";
export type * from "./user/request";
export type * from "./user/response";
export type * from "./home/request";
export type * from "./home/response";
export type * from "./application/request";
export type * from "./application/response";
export type * from "./interview/request";
export type * from "./interview/response";
export type * from "./result/request";
export type * from "./result/response";
export type * from "./growth/request";
export type * from "./growth/response";
