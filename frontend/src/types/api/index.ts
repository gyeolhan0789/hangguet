// API 요청 · 응답 타입 모음. 기준: 웹 mock 서버 Swagger(https://hangguet.yobistory.com/mock/be/v3/api-docs).
// 그룹 면접(10장)은 웹 mock에 없어 BE Swagger(https://hangguet.yobistory.com/be/v3/api-docs)를 기준으로 한다.
// 폴더는 Swagger 번호의 장(1 인증 ~ 10 그룹 면접)마다 나누고, 그 안에서 request · response로 나눈다.
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
export type * from "./admin/request";
export type * from "./admin/response";
export type * from "./inquiry/request";
export type * from "./inquiry/response";
export type * from "./group/request";
export type * from "./group/response";
